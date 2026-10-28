import { prisma } from "@/lib/prisma";
import { WhatsAppInstance } from "./instance";
import { Server } from "socket.io";
import { logger } from "@/lib/logger";
import { getBrandConfig } from "@/lib/branding-server";
import { getDefaultBotName } from "@/lib/branding";

const globalForWhatsapp = globalThis as typeof globalThis & {
    waManager?: WhatsAppManager;
    io?: Server;
};

export class WhatsAppManager {
    private static instance: WhatsAppManager;
    private sessions: Map<string, WhatsAppInstance> = new Map();
    private starts: Map<string, Promise<void>> = new Map();
    private loadPromise: Promise<void> | null = null;
    public io: Server | null = null;

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
        const sessions = await prisma.session.findMany({
            where: {
                status: { not: "LOGGED_OUT" }
            },
            select: { sessionId: true, userId: true, status: true }
        });

        let started = 0;
        for (const session of sessions) {
            const existing = this.sessions.get(session.sessionId);
            if (existing) {
                await existing.init();
                started++;
                continue;
            }
            // Only auto-init sessions that were CONNECTED before (have auth creds)
            const authCount = await prisma.authState.count({
                where: { sessionId: session.sessionId }
            });
            if (authCount === 0) {
                // No credentials — session was created but never connected
                // Set to STOPPED so it doesn't spam reconnect
                await prisma.session.update({
                    where: { sessionId: session.sessionId },
                    data: { status: "STOPPED" }
                }).catch(() => {});
                continue;
            }

            const instance = new WhatsAppInstance(session.sessionId, session.userId, this.io);
            instance.onRemovedFromManager = () => this.removeInstance(session.sessionId, instance);
            this.sessions.set(session.sessionId, instance);
            await instance.init();
            started++;
        }
        logger.success("Manager", `Loaded ${started} sessions (${sessions.length - started} idle skipped).`);
    }

    async createSession(userId: string, name: string, customSessionId?: string) {
        if (!this.io && globalForWhatsapp.io) {
            this.io = globalForWhatsapp.io;
        }

        if (!this.io) {
            logger.error("Manager", "Socket.IO not initialized in WhatsAppManager");
            throw new Error("Socket.IO not initialized");
        }

        const sessionId = customSessionId || Math.random().toString(36).substring(7);
        const brand = await getBrandConfig();

        const session = await prisma.session.create({
            data: {
                userId,
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
        await prisma.session.delete({ where: { sessionId } });
    }

    async stopSession(sessionId: string) {
        await this.starts.get(sessionId)?.catch(() => undefined);
        const instance = this.sessions.get(sessionId);
        if (instance) {
            await instance.shutdown();
            instance.status = "STOPPED";
            this.io?.to(sessionId).emit("connection.update", { status: "STOPPED", qr: null });
            await prisma.session.update({
                where: { sessionId },
                data: { status: "STOPPED" }
            }).catch(() => {});
            // Remove from memory immediately
            this.sessions.delete(sessionId);
        }
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

        const session = await prisma.session.findUnique({ where: { sessionId } });
        if (!session) throw new Error("Session not found");

        const instance = new WhatsAppInstance(sessionId, session.userId, this.io!);
        instance.onRemovedFromManager = () => this.removeInstance(sessionId, instance);
        this.sessions.set(sessionId, instance);
        await instance.init();
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
}

export const waManager = globalForWhatsapp.waManager ?? WhatsAppManager.getInstance();

globalForWhatsapp.waManager = waManager;
