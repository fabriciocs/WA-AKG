import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { randomUUID } from "node:crypto";

interface AntiSpamConfig {
    antiSpamEnabled: boolean;
    spamLimit: number;
    spamInterval: number;
    spamDelayMin: number;
    spamDelayMax: number;
}

interface QueueItem {
    id: number;
    jid: string;
    messageType: string;
    queuedAt: number;
    send: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
}

const MAX_QUEUE_PER_SESSION = 500;

export class AntiSpamManager {
    private static instance: AntiSpamManager;
    private configCache = new Map<string, { config: AntiSpamConfig; cachedAt: number }>();
    private processing = new Set<string>();
    private queues = new Map<string, QueueItem[]>();
    private messageCounter = 0;

    constructor(private readonly db: typeof prisma = prisma) {}

    static getInstance() {
        if (!AntiSpamManager.instance) AntiSpamManager.instance = new AntiSpamManager();
        return AntiSpamManager.instance;
    }

    /** Resolve only after the actual Baileys send has completed. */
    async enqueue<T>(sessionId: string, jid: string, content: unknown, send: () => Promise<T>): Promise<T> {
        const config = await this.getAntiSpamConfig(sessionId);
        if (!config.antiSpamEnabled) return send();

        const queue = this.queues.get(sessionId) ?? [];
        if (queue.length >= MAX_QUEUE_PER_SESSION) {
            throw new Error("WhatsApp send queue is full; retry later");
        }

        const result = new Promise<T>((resolve, reject) => {
            queue.push({
                id: ++this.messageCounter,
                jid,
                messageType: this.detectMessageType(content),
                queuedAt: Date.now(),
                send: () => send(),
                resolve: value => resolve(value as T),
                reject
            });
        });
        this.queues.set(sessionId, queue);
        void this.processQueue(sessionId);
        return result;
    }

    private async processQueue(sessionId: string) {
        if (this.processing.has(sessionId)) return;
        this.processing.add(sessionId);
        try {
            while (true) {
                const queue = this.queues.get(sessionId);
                const item = queue?.[0];
                if (!queue || !item) return;

                try {
                    const config = await this.getAntiSpamConfig(sessionId);
                    const result = config.antiSpamEnabled
                        ? await this.sendWithDistributedThrottle(sessionId, config, item.send)
                        : await item.send();
                    queue.shift();
                    item.resolve(result);
                } catch (error) {
                    queue.shift();
                    item.reject(error);
                    logger.error("Anti-Spam", `Queued send ${item.id} failed for ${this.formatJid(item.jid)}`, error);
                }
            }
        } finally {
            this.processing.delete(sessionId);
            if (!this.queues.get(sessionId)?.length) this.queues.delete(sessionId);
            else queueMicrotask(() => void this.processQueue(sessionId));
        }
    }

    private async sendWithDistributedThrottle<T>(sessionId: string, config: AntiSpamConfig, send: () => Promise<T>): Promise<T> {
        await this.db.whatsAppSendThrottle.upsert({
            where: { sessionId },
            create: { sessionId },
            update: {}
        });

        const token = randomUUID();
        const acquireUntil = Date.now() + 30 * 60 * 1000;
        let acquired = false;
        while (Date.now() < acquireUntil) {
            const now = new Date();
            const claim = await this.db.whatsAppSendThrottle.updateMany({
                where: { sessionId, OR: [{ leaseToken: null }, { leaseUntil: { lte: now } }] },
                data: { leaseToken: token, leaseUntil: new Date(now.getTime() + 60000) }
            });
            if (claim.count === 1) {
                acquired = true;
                break;
            }
            await this.sleep(100);
        }
        if (!acquired) throw new Error("Timed out waiting for the shared WhatsApp send lock");

        const heartbeat = setInterval(() => {
            void this.db.whatsAppSendThrottle.updateMany({
                where: { sessionId, leaseToken: token },
                data: { leaseUntil: new Date(Date.now() + 60000) }
            }).catch(error => logger.error("Anti-Spam", "Shared send lock heartbeat failed", error));
        }, 20000);
        heartbeat.unref?.();

        let nextAllowedAt: Date | null = null;
        try {
            const state = await this.db.whatsAppSendThrottle.findUnique({ where: { sessionId } });
            if (state?.nextAllowedAt && state.nextAllowedAt.getTime() > Date.now()) {
                await this.sleep(state.nextAllowedAt.getTime() - Date.now());
            }
            return await send();
        } finally {
            clearInterval(heartbeat);
            const min = Math.min(config.spamDelayMin, config.spamDelayMax);
            const max = Math.max(config.spamDelayMin, config.spamDelayMax);
            const configuredGap = min + Math.floor(Math.random() * (max - min + 1));
            const rateGap = Math.ceil(config.spamInterval * 1000 / config.spamLimit);
            nextAllowedAt = new Date(Date.now() + Math.max(configuredGap, rateGap));
            await this.db.whatsAppSendThrottle.updateMany({
                where: { sessionId, leaseToken: token },
                data: { nextAllowedAt, leaseToken: null, leaseUntil: null }
            }).catch(error => logger.error("Anti-Spam", "Unable to release shared send lock; lease will expire", error));
        }
    }

    private detectMessageType(content: unknown): string {
        if (!content || typeof content !== "object") return "unknown";
        const message = content as Record<string, unknown>;
        for (const key of ["text", "image", "video", "audio", "document", "sticker", "react", "delete", "poll", "location", "contact"]) {
            if (message[key]) return key;
        }
        return "other";
    }

    private formatJid(jid: string): string {
        if (jid.endsWith("@s.whatsapp.net")) return jid.replace("@s.whatsapp.net", "");
        if (jid.endsWith("@g.us")) return `group:${jid.replace("@g.us", "").slice(-6)}`;
        return jid.slice(0, 15);
    }

    private sleep(ms: number) {
        return new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    private async getAntiSpamConfig(sessionId: string): Promise<AntiSpamConfig> {
        const cached = this.configCache.get(sessionId);
        if (cached && Date.now() - cached.cachedAt < 10000) return cached.config;

        // DB errors are propagated; they must not turn protection into a bypass.
        const session = await this.db.session.findUnique({
            where: { sessionId },
            select: {
                botConfig: {
                    select: {
                        antiSpamEnabled: true,
                        spamLimit: true,
                        spamInterval: true,
                        spamDelayMin: true,
                        spamDelayMax: true
                    }
                }
            }
        });
        const row = session?.botConfig;
        const limit = Number(row?.spamLimit) || 5;
        const interval = Number(row?.spamInterval) || 10;
        const minDelay = Number(row?.spamDelayMin) || 1000;
        const maxDelay = Number(row?.spamDelayMax) || 3000;
        const config: AntiSpamConfig = {
            antiSpamEnabled: Boolean(row?.antiSpamEnabled),
            spamLimit: Math.max(1, Math.min(limit, 100)),
            spamInterval: Math.max(1, Math.min(interval, 3600)),
            spamDelayMin: Math.max(0, Math.min(minDelay, 60000)),
            spamDelayMax: Math.max(0, Math.min(maxDelay, 60000))
        };
        this.configCache.set(sessionId, { config, cachedAt: Date.now() });
        return config;
    }

    clearCache(sessionId: string) {
        this.configCache.delete(sessionId);
    }
}

export const antispam = AntiSpamManager.getInstance();
