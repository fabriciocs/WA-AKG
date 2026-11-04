import { prisma } from "@/lib/prisma";
import { WhatsAppInstance } from "./instance";
import { Server } from "socket.io";
import { logger } from "@/lib/logger";
import { getBrandConfig } from "@/lib/branding-server";
import { getDefaultBotName } from "@/lib/branding";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { emitSessionRoomEvent } from "@/server/socket";
import { generateSessionId, isValidSessionId } from "@/lib/session-id";

const SESSION_LEASE_MS = 90_000;
const SESSION_LEASE_RENEW_MS = 30_000;

const globalForWhatsapp = globalThis as typeof globalThis & {
    waManager?: WhatsAppManager;
    io?: Server;
};

export class WhatsAppManager {
    private static instance: WhatsAppManager;
    private sessions: Map<string, WhatsAppInstance> = new Map();
    private starts: Map<string, Promise<void>> = new Map();
    private leaseTokens: Map<string, string> = new Map();
    private leaseTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
    private loadPromise: Promise<void> | null = null;
    public io: Server | null = null;
    private readonly workerId = `${process.env.WA_AKG_WORKER_ID || "wa-akg"}:${os.hostname()}:${process.pid}:${randomUUID()}`;

    private constructor() {}

    public static getInstance(): WhatsAppManager {
        if (!WhatsAppManager.instance) {
            WhatsAppManager.instance = new WhatsAppManager();
        }
        return WhatsAppManager.instance;
    }

    setup(io: Server) {
        this.io = io;
    }

    async loadSessions() {
        if (this.loadPromise) return this.loadPromise;
        const pending = this.loadSessionsOnce().finally(() => {
            if (this.loadPromise === pending) this.loadPromise = null;
        });
        this.loadPromise = pending;
        return pending;
    }

    private async loadSessionsOnce() {
        if (!this.io) throw new Error("Socket.IO not initialized in WhatsAppManager");
        // Do not silently fall back to unsafe multi-replica behavior when the
        // ownership migration has not been applied.
        await prisma.whatsAppSessionLease.count();
        const sessions = await prisma.session.findMany({
            where: {
                status: { not: "LOGGED_OUT" },
                tenant: { status: "ACTIVE" }
            },
            select: { sessionId: true, userId: true, status: true, tenantId: true }
        });

        let started = 0;
        for (const session of sessions) {
            if (!session.tenantId) continue;
            const existing = this.sessions.get(session.sessionId);
            if (existing?.tenantId === session.tenantId && existing.userId === session.userId) {
                await existing.init();
                started++;
                continue;
            }
            // Only auto-init sessions that were CONNECTED before (have auth creds)
            const authCount = await prisma.authState.count({
                where: { sessionId: session.sessionId, tenantId: session.tenantId }
            });
            if (authCount === 0) {
                // No credentials — session was created but never connected
                // Set to STOPPED so it doesn't spam reconnect
                await prisma.session.update({
                    where: { sessionId: session.sessionId, tenantId: session.tenantId },
                    data: { status: "STOPPED" }
                }).catch(() => {});
                continue;
            }

            if (!(await this.acquireSessionLease(session.sessionId, session.tenantId))) {
                logger.warn("Manager", `Skipping session ${session.sessionId}; another replica owns the Baileys lease.`);
                continue;
            }

            const instance = new WhatsAppInstance(session.sessionId, session.userId, session.tenantId, this.io);
            instance.onRemovedFromManager = () => {
                this.removeInstance(session.sessionId, instance);
                void this.releaseSessionLease(session.sessionId);
            };
            this.sessions.set(session.sessionId, instance);
            try {
                await instance.init();
            } catch (error) {
                this.removeInstance(session.sessionId, instance);
                await this.releaseSessionLease(session.sessionId);
                throw error;
            }
            started++;
        }
        logger.success("Manager", `Loaded ${started} sessions (${sessions.length - started} idle skipped).`);
    }

    async createSession(userId: string, name: string, customSessionId: string | undefined, tenantId: string) {
        if (!this.io && globalForWhatsapp.io) {
            this.io = globalForWhatsapp.io;
        }

        if (!this.io) {
            logger.error("Manager", "Socket.IO not initialized in WhatsAppManager");
            throw new Error("Socket.IO not initialized");
        }

        if (customSessionId !== undefined && !isValidSessionId(customSessionId)) {
            throw new Error("Invalid sessionId");
        }
        const sessionId = customSessionId || generateSessionId();
        const brand = await getBrandConfig();

        const session = await prisma.session.create({
            data: {
                userId,
                tenantId,
                name,
                sessionId,
                status: "STOPPED", // Default: stopped, user must click Start
                botConfig: {
                    create: {
                        enabled: true,
                        botMode: "OWNER",
                        autoReplyMode: "ALL",
                        botName: getDefaultBotName(brand.name)
                    }
                }
            }
        });

        // Don't init socket — user clicks Start manually
        logger.info("Manager", `Session ${sessionId} created (STOPPED). User must click Start to connect.`);
        return session;
    }

    public getInstance(sessionId: string) {
        return this.sessions.get(sessionId);
    }

    /** Remove instance from memory manager (cleanup after stop/logout) */
    public removeInstance(sessionId: string, expected?: WhatsAppInstance) {
        const inst = this.sessions.get(sessionId);
        if (expected && inst !== expected) return;
        if (inst) {
            logger.info("Manager", `Removing session ${sessionId} from memory.`);
            this.sessions.delete(sessionId);
        }
    }

    async deleteSession(sessionId: string) {
        await this.starts.get(sessionId)?.catch(() => undefined);
        const instance = this.sessions.get(sessionId);
        if (instance) {
            await instance.shutdown();
            this.sessions.delete(sessionId);
        }
        await this.releaseSessionLease(sessionId);
        await prisma.session.delete({ where: { sessionId } });
    }

    async stopSession(sessionId: string) {
        await this.starts.get(sessionId)?.catch(() => undefined);
        const instance = this.sessions.get(sessionId);
        if (instance) {
            await instance.shutdown();
            instance.status = "STOPPED";
            void emitSessionRoomEvent(this.io, instance.tenantId, sessionId, "connection.update", { status: "STOPPED" });
            await prisma.session.update({
                where: { sessionId },
                data: { status: "STOPPED" }
            }).catch(() => {});
            // Remove from memory immediately
            this.sessions.delete(sessionId);
        }
        await this.releaseSessionLease(sessionId);
    }

    async startSession(sessionId: string) {
        const pending = this.starts.get(sessionId);
        if (pending) return pending;
        const start = this.startSessionOnce(sessionId).finally(() => {
            if (this.starts.get(sessionId) === start) this.starts.delete(sessionId);
        });
        this.starts.set(sessionId, start);
        return start;
    }

    private async startSessionOnce(sessionId: string) {
        // If already running, do nothing
        const existingInstance = this.sessions.get(sessionId);
        if (existingInstance) {
            if (existingInstance.status === "CONNECTED" || existingInstance.status === "SCAN_QR") return;
            await existingInstance.init();
            return;
        }

        const session = await prisma.session.findUnique({ where: { sessionId, tenant: { status: "ACTIVE" } } });
        if (!session?.tenantId) throw new Error("Session not found");

        if (!(await this.acquireSessionLease(sessionId, session.tenantId))) {
            throw new Error("WhatsApp session is active on another replica");
        }

        const instance = new WhatsAppInstance(sessionId, session.userId, session.tenantId, this.io!);
        instance.onRemovedFromManager = () => {
            this.removeInstance(sessionId, instance);
            void this.releaseSessionLease(sessionId);
        };
        this.sessions.set(sessionId, instance);
        try {
            await instance.init();
        } catch (error) {
            this.removeInstance(sessionId, instance);
            await this.releaseSessionLease(sessionId);
            throw error;
        }
    }

    async restartSession(sessionId: string) {
        await this.stopSession(sessionId);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.startSession(sessionId);
    }

    async requestPairingCode(sessionId: string, phoneNumber: string) {
        const instance = this.sessions.get(sessionId);
        if (!instance) throw new Error("Instance not found or not running");
        return await instance.requestPairingCode(phoneNumber);
    }

    async shutdownAll() {
        const entries = [...this.sessions.entries()];
        await Promise.all(entries.map(async ([sessionId, instance]) => {
            await instance.shutdown();
            this.removeInstance(sessionId, instance);
            await this.releaseSessionLease(sessionId);
        }));
    }

    private async acquireSessionLease(sessionId: string, tenantId: string) {
        const leaseToken = randomUUID();
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + SESSION_LEASE_MS);

        let acquired = await prisma.whatsAppSessionLease.updateMany({
            where: {
                sessionId,
                tenantId,
                OR: [
                    { ownerId: this.workerId },
                    { leaseUntil: { lte: now } }
                ]
            },
            data: {
                ownerId: this.workerId,
                leaseToken,
                leaseUntil,
                fencingToken: { increment: 1 }
            }
        });

        if (acquired.count === 0) {
            try {
                await prisma.whatsAppSessionLease.create({
                    data: { sessionId, tenantId, ownerId: this.workerId, leaseToken, leaseUntil }
                });
                acquired = { count: 1 };
            } catch (error: unknown) {
                // Another replica may have created the row between the update
                // and create. It remains the owner unless the lease is expired.
                if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
                acquired = await prisma.whatsAppSessionLease.updateMany({
                    where: { sessionId, tenantId, leaseUntil: { lte: new Date() } },
                    data: { ownerId: this.workerId, leaseToken, leaseUntil, fencingToken: { increment: 1 } }
                });
            }
        }

        if (acquired.count === 0) return false;

        this.leaseTokens.set(sessionId, leaseToken);
        const existingTimer = this.leaseTimers.get(sessionId);
        if (existingTimer) clearInterval(existingTimer);
        const timer = setInterval(() => {
            void this.renewSessionLease(sessionId, tenantId, leaseToken);
        }, SESSION_LEASE_RENEW_MS);
        timer.unref?.();
        this.leaseTimers.set(sessionId, timer);
        return true;
    }

    private async renewSessionLease(sessionId: string, tenantId: string, leaseToken: string) {
        let renewed: { count: number };
        try {
            const session = await prisma.session.findUnique({
                where: { sessionId, tenantId, tenant: { status: "ACTIVE" } },
                select: { userId: true },
            });
            const instance = this.sessions.get(sessionId);
            renewed = session && session.userId === instance?.userId ? await prisma.whatsAppSessionLease.updateMany({
                where: {
                    sessionId,
                    tenantId,
                    ownerId: this.workerId,
                    leaseToken,
                    leaseUntil: { gt: new Date() }
                },
                data: { leaseUntil: new Date(Date.now() + SESSION_LEASE_MS) }
            }) : { count: 0 };
        } catch (error) {
            logger.error("Manager", `Unable to renew distributed Baileys lease for session ${sessionId}; stopping local instance.`, error);
            renewed = { count: 0 };
        }
        if (renewed.count > 0) return;

        const timer = this.leaseTimers.get(sessionId);
        if (timer) clearInterval(timer);
        this.leaseTimers.delete(sessionId);
        this.leaseTokens.delete(sessionId);
        const instance = this.sessions.get(sessionId);
        if (instance) {
            logger.error("Manager", `Lost distributed Baileys lease for session ${sessionId}; stopping local instance.`);
            await instance.shutdown().catch((error) => logger.error("Manager", `Failed to stop session ${sessionId} after lease loss.`, error));
            this.removeInstance(sessionId, instance);
        }
    }

    private async releaseSessionLease(sessionId: string) {
        const leaseToken = this.leaseTokens.get(sessionId);
        const timer = this.leaseTimers.get(sessionId);
        if (timer) clearInterval(timer);
        this.leaseTimers.delete(sessionId);
        this.leaseTokens.delete(sessionId);
        if (!leaseToken) return;
        await prisma.whatsAppSessionLease.deleteMany({
            where: { sessionId, ownerId: this.workerId, leaseToken }
        });
    }
}

export const waManager = globalForWhatsapp.waManager ?? WhatsAppManager.getInstance();

globalForWhatsapp.waManager = waManager;
