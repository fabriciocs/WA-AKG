import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    ConnectionState
} from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { loadPrismaAuthState } from "./auth/usePrismaAuthState";
import { Server } from "socket.io";
import pino from "pino";
import { bindSessionStore } from "./store";
import { syncGroups } from "./store/groups";
import { bindContactSync } from "./store/contacts";
import { bindAutoReply } from "./store/autoreply";
import { antispam } from "./antispam";
import { logger } from "@/lib/logger";
import { isInteractiveContent, handleInteractiveMessageDispatch } from "./interactive";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import {
    createPrivateConnectionUpdate,
    createPublicConnectionUpdate,
    emitSessionRoomEvent
} from "@/server/socket";

const MAX_RECONNECT_ATTEMPTS = 3;
type WhatsAppSocketWithHelpers = WASocket & {
    newsletterId: (url: string) => Promise<string | null>;
    newsletterMetadata: (type: string, code: string) => Promise<{ id?: string } | null>;
    checkWhatsApp: WASocket["onWhatsApp"];
};

function getDisconnectStatusCode(error: unknown) {
    if (!error || typeof error !== "object") return undefined;
    const output = (error as { output?: { statusCode?: unknown } }).output;
    return output?.statusCode;
}

export class WhatsAppInstance {
    socket: WASocket | null = null;
    qr: string | null = null;
    rq: string | null = null;
    status: string = "DISCONNECTED";
    sessionId: string;
    readonly userId: string;
    readonly tenantId: string;
    io: Server;
    config: unknown = {};
    startTime: Date | null = null;
    pairingCode: string | null = null;

    isStopped: boolean = false;
    private reconnectCount: number = 0;
    private initPromise: Promise<void> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private generation = 0;
    private boundOpenGeneration = 0;
    /** Called when instance auto-stops or logs out — lets manager remove it from Map */
    onRemovedFromManager: (() => void) | null = null;

    constructor(sessionId: string, userId: string, tenantId: string, io: Server) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.tenantId = tenantId;
        this.io = io;
    }

    async init() {
        if (this.isStopped) return;
        if (this.initPromise) return this.initPromise;
        if (this.socket && ["SCAN_QR", "CONNECTED"].includes(this.status)) return;

        const generation = ++this.generation;
        const pending = this.initialize(generation).finally(() => {
            if (this.initPromise === pending) this.initPromise = null;
        });
        this.initPromise = pending;
        return pending;
    }

    private async initialize(generation: number) {
        const sessionData = await prisma.session.findUnique({
            where: { sessionId: this.sessionId, tenantId: this.tenantId, userId: this.userId, tenant: { status: "ACTIVE" } },
            include: { botConfig: true }
        });
        if (!sessionData) {
            logger.warn("Instance", `Session ${this.sessionId} not found in DB, aborting init`);
            return;
        }
        if (this.isStopped || generation !== this.generation) return;
        this.config = sessionData?.config || {};
        const botConfig = sessionData.botConfig;

        const { state, saveCreds } = await loadPrismaAuthState(this.sessionId, this.tenantId);
        const { version } = await fetchLatestBaileysVersion();
        if (this.isStopped || generation !== this.generation) return;

        const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as unknown as Parameters<typeof makeCacheableSignalKeyStore>[1];
        this.socket = makeWASocket({
            version,
            logger: baileysLogger,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
            },
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            markOnlineOnConnect: botConfig?.alwaysOnline ?? true,
            syncFullHistory: true,
        });

        // Attach Lekzo Baileys compatible helper methods
        const currentSocket = this.socket as WhatsAppSocketWithHelpers;
        currentSocket.newsletterId = async (url: string) => {
            const cleanUrl = url.trim();
            const inviteCode = cleanUrl.includes("/") ? cleanUrl.split("/").filter(Boolean).pop()! : cleanUrl;
            const meta = await currentSocket.newsletterMetadata("invite", inviteCode);
            return meta?.id || null;
        };
        currentSocket.checkWhatsApp = async (target: string) => {
            return await currentSocket.onWhatsApp(target);
        };

        // Apply Anti-Spam & Interactive Message Wrapper to sendMessage
        const originalSendMessage = this.socket.sendMessage.bind(this.socket);
        const sessionId = this.sessionId;
        const sock = this.socket;
        const sendMessage: WASocket["sendMessage"] = async (jid, content, options) => {
            return antispam.enqueue(sessionId, jid, content, async () => {
                if (this.isStopped || this.socket !== sock || generation !== this.generation) {
                    throw new Error("WhatsApp session is no longer active");
                }
                const current = await prisma.session.findUnique({
                    where: { sessionId, tenantId: this.tenantId, userId: this.userId, tenant: { status: "ACTIVE" } },
                    select: { id: true, tenantId: true },
                });
                if (!current || !(await prisma.tenantMembership.findFirst({
                    where: { tenantId: this.tenantId, userId: this.userId, status: "ACTIVE" },
                    select: { id: true },
                }))) throw new Error("WhatsApp session tenant binding is invalid");
                if (isInteractiveContent(content)) {
                    const interactiveMsg = await handleInteractiveMessageDispatch(sock, jid, content, options);
                    if (interactiveMsg) return interactiveMsg;
                }
                return originalSendMessage(jid, content, options);
            });
        };
        this.socket.sendMessage = sendMessage;

        // Bind Store for DB Sync
        bindSessionStore(this.socket, this.sessionId, this.tenantId, this.io);

        // Bind Contact Sync
        bindContactSync(this.socket, this.sessionId, this.tenantId);

        this.socket.ev.on("creds.update", saveCreds);

        this.socket.ev.on("connection.update", async (update) => {
            if (generation !== this.generation) return;
            await this.handleConnectionUpdate(update, generation);
        });
    }

    async handleConnectionUpdate(update: Partial<ConnectionState>, generation = this.generation) {
        if (generation !== this.generation) return;
        const { connection, lastDisconnect, qr } = update;

        try {
            if (qr) {
                if (this.isStopped) return;
                // Reset reconnect count on new QR (user is re-scanning)
                this.reconnectCount = 0;
                this.qr = qr;
                this.status = "SCAN_QR";

                this.pairingCode = null;
                await this.emitPublicConnectionUpdate();
                await this.emitPrivateConnectionUpdate(createPrivateConnectionUpdate(this.status, qr, null));

                await prisma.session.update({
                    where: { sessionId: this.sessionId, tenantId: this.tenantId },
                    data: { qr, status: "SCAN_QR" }
                });
            }

            if (connection === "close") {
                const code = getDisconnectStatusCode(lastDisconnect?.error);
                const isLoggedOut = code === DisconnectReason.loggedOut;

                if (isLoggedOut) {
                    // Logged out: stop permanently, remove from memory
                    this.status = "LOGGED_OUT";
                    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                    this.socket = null;
                    this.config = {};
                    this.qr = null;
                    this.pairingCode = null;
                    await this.emitPublicConnectionUpdate("LOGGED_OUT");
                    await this.emitPrivateConnectionUpdate(createPrivateConnectionUpdate("LOGGED_OUT"));

                    logger.info("Instance", `Session ${this.sessionId} logged out. Deleting credentials...`);
                    try {
                        await prisma.$transaction([
                            prisma.session.update({
                                where: { sessionId: this.sessionId, tenantId: this.tenantId },
                                data: { status: "LOGGED_OUT", qr: null }
                            }),
                            prisma.authState.deleteMany({
                                where: { sessionId: this.sessionId, tenantId: this.tenantId }
                            })
                        ]);
                    } catch { /* Auth row cleanup is best effort after logout. */ }
                    logger.success("Instance", `Session ${this.sessionId} credentials deleted.`);

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                    return;
                }

                if (this.isStopped) {
                    // Explicitly stopped: preserve creds for restart
                    this.status = "STOPPED";
                    this.socket = null;
                    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                    this.reconnectCount = 0;
                    this.qr = null;
                    this.pairingCode = null;
                    await this.emitPublicConnectionUpdate("STOPPED");
                    await this.emitPrivateConnectionUpdate(createPrivateConnectionUpdate("STOPPED"));

                    await prisma.session.update({
                        where: { sessionId: this.sessionId, tenantId: this.tenantId },
                        data: { status: "STOPPED", qr: null }
                    }).catch(() => {});
                    logger.warn("Instance", `Session ${this.sessionId} stopped. Credentials preserved.`);

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                    return;
                }

                // Unexpected disconnect: retry with limit
                this.socket = null;
                if (this.reconnectTimer) return;
                this.reconnectCount++;
                const remaining = MAX_RECONNECT_ATTEMPTS - this.reconnectCount + 1;

                if (remaining > 0) {
                    this.status = "DISCONNECTED";
                    this.qr = null;
                    this.pairingCode = null;
                    await this.emitPublicConnectionUpdate("DISCONNECTED");
                    await this.emitPrivateConnectionUpdate(createPrivateConnectionUpdate("DISCONNECTED"));
                    await prisma.session.update({
                        where: { sessionId: this.sessionId, tenantId: this.tenantId },
                        data: { status: "DISCONNECTED", qr: null }
                    }).catch(() => {});

                    logger.warn("Instance",
                        `Session ${this.sessionId} disconnected. Reconnecting (${this.reconnectCount}/${MAX_RECONNECT_ATTEMPTS})...`
                    );
                    this.reconnectTimer = setTimeout(() => {
                        this.reconnectTimer = null;
                        if (!this.isStopped && generation === this.generation) void this.init();
                    }, 3000);
                    this.reconnectTimer.unref?.();
                } else {
                    // Max retries exceeded — auto-stop
                    this.status = "STOPPED";
                    this.socket = null;
                    this.reconnectCount = 0;
                    this.isStopped = true; // prevent further retries
                    this.qr = null;
                    this.pairingCode = null;
                    await this.emitPublicConnectionUpdate("STOPPED");
                    await this.emitPrivateConnectionUpdate(createPrivateConnectionUpdate("STOPPED"));

                    await prisma.session.update({
                        where: { sessionId: this.sessionId, tenantId: this.tenantId },
                        data: { status: "STOPPED", qr: null }
                    }).catch(() => {});
                    logger.error("Instance",
                        `Session ${this.sessionId} max reconnects (${MAX_RECONNECT_ATTEMPTS}) reached. Auto-stopped.`
                    );

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                }
            }

            if (connection === "open") {
                if (this.boundOpenGeneration === generation) return;
                this.boundOpenGeneration = generation;
                // Connected — reset reconnect count
                this.reconnectCount = 0;
                this.isStopped = false;
                this.status = "CONNECTED";
                this.qr = null;
                this.pairingCode = null;
                this.startTime = new Date();

                await this.emitPublicConnectionUpdate("CONNECTED");
                await this.emitPrivateConnectionUpdate(createPrivateConnectionUpdate("CONNECTED"));

                try {
                    await syncGroups(this.socket as WASocket, this.sessionId, this.tenantId);
                } catch (e) {
                    logger.error("Instance", "Group sync failed:", e);
                }

                bindAutoReply(this.socket as WASocket, this.sessionId, this.tenantId);

                await prisma.session.update({
                    where: { sessionId: this.sessionId, tenantId: this.tenantId },
                    data: { status: "CONNECTED", qr: null }
                });

                logger.success("Instance", `Session ${this.sessionId} connected and synced successfully`);
            }
        } catch (error: unknown) {
            const errorCode = error && typeof error === "object" && "code" in error
                ? error.code
                : undefined;
            if (errorCode === "P2025") {
                logger.warn("Instance", `Session ${this.sessionId} record not found during update. Stopping.`);
                this.socket?.end(undefined);
                this.socket = null;
            } else {
                logger.error("Instance", "Error in handleConnectionUpdate:", error);
            }
        }
    }

    async requestPairingCode(phoneNumber: string) {
        if (!this.socket) {
            throw new Error("Socket not initialized");
        }

        try {
            const cleanNumber = normalizeWhatsAppPhone(phoneNumber);
            if (!cleanNumber) throw new Error("Invalid WhatsApp phone number");

            const code = await this.socket.requestPairingCode(cleanNumber);
            this.pairingCode = code;
            this.status = "SCAN_QR";

            await this.emitPublicConnectionUpdate();
            await this.emitPrivateConnectionUpdate(createPrivateConnectionUpdate(this.status, this.qr, code));

            return code;
        } catch (error) {
            logger.error("Instance", "Pairing code error:", error);
            throw error;
        }
    }

    private emitPublicConnectionUpdate(status = this.status) {
        return emitSessionRoomEvent(this.io, this.tenantId, this.sessionId, "connection.update", createPublicConnectionUpdate(status));
    }

    private emitPrivateConnectionUpdate(update: ReturnType<typeof createPrivateConnectionUpdate>) {
        return emitSessionRoomEvent(this.io, this.tenantId, this.sessionId, "connection.update", update, "private");
    }

    /** Clean shutdown without triggering reconnect */
    async shutdown() {
        this.isStopped = true;
        this.generation++;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.socket?.end(undefined);
        this.socket = null;
        this.reconnectCount = 0;
    }
}
