import cron from "node-cron";
import cronParser from "cron-parser";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { safeFetchBuffer } from "@/lib/security";
import { logger } from "./logger";
import type { PrismaClient } from "@prisma/client";

const LEASE_MS = 10 * 60 * 1000;
const BATCH_SIZE = 20;
type SocketEmitter = { to: (room: string) => { emit: (event: string, payload: unknown) => void } };
let scheduledTask: ReturnType<typeof cron.schedule> | null = null;

type LeaseModel = "scheduledMessage" | "broadcastRecipient" | "broadcastLog";
type LeaseHeartbeatTimer = { unref?: () => unknown };
type LeaseHeartbeatDelegate = {
    updateMany: (args: { where: { id: string; claimToken: string }; data: { claimedAt: Date } }) => Promise<unknown>;
};

type LeaseHeartbeatDependencies = {
    delegates: Record<LeaseModel, LeaseHeartbeatDelegate>;
    schedule: (callback: () => void, intervalMs: number) => LeaseHeartbeatTimer;
    clear: (timer: LeaseHeartbeatTimer) => void;
    now: () => Date;
    intervalMs: number;
    logError: (id: string, error: unknown) => void;
};

/** Creates a lease refresher with injectable timers and model delegates for unit tests. */
export function createLeaseHeartbeat(dependencies: LeaseHeartbeatDependencies) {
    const { delegates, schedule, clear, now, intervalMs, logError } = dependencies;
    return function heartbeat(model: LeaseModel, id: string, token: string) {
        const timer = schedule(() => {
            void delegates[model].updateMany({
                where: { id, claimToken: token },
                data: { claimedAt: now() }
            }).catch(error => logError(id, error));
        }, intervalMs);
        timer.unref?.();
        return () => clear(timer);
    };
}

const heartbeat = createLeaseHeartbeat({
    delegates: {
        scheduledMessage: { updateMany: args => prisma.scheduledMessage.updateMany(args) },
        broadcastRecipient: { updateMany: args => prisma.broadcastRecipient.updateMany(args) },
        broadcastLog: { updateMany: args => prisma.broadcastLog.updateMany(args) }
    },
    schedule: (callback, intervalMs) => setInterval(callback, intervalMs),
    clear: timer => clearInterval(timer as ReturnType<typeof setInterval>),
    now: () => new Date(),
    intervalMs: Math.floor(LEASE_MS / 3),
    logError: (id, error) => logger.error("Scheduler", `Lease heartbeat failed for ${id}`, error)
});

type ScheduledMessageDelegate = Pick<
    PrismaClient["scheduledMessage"],
    "findMany" | "findFirst" | "updateMany"
>;

type ScheduledMessageProcessorDependencies = {
    scheduledMessage: ScheduledMessageDelegate;
    getSender: (sessionId: string) => ((jid: string, content: Awaited<ReturnType<typeof buildScheduledContent>>) => Promise<unknown>) | undefined;
    buildContent: typeof buildScheduledContent;
    startHeartbeat: (id: string, token: string) => () => void;
    createToken: () => string;
    logError: (message: string, error?: unknown) => void;
    logWarn: (message: string) => void;
};

/** Creates the scheduled-message worker with injectable boundaries for deterministic tests. */
export function createScheduledMessageProcessor(dependencies: ScheduledMessageProcessorDependencies) {
    const { scheduledMessage, getSender, buildContent, startHeartbeat, createToken, logError, logWarn } = dependencies;

    return async function processScheduledMessages(now: Date) {
    const expiredBefore = new Date(now.getTime() - LEASE_MS);
    const candidates = await scheduledMessage.findMany({
        where: {
            OR: [
                { status: "PENDING", sendAt: { lte: now } },
                { status: "PROCESSING", claimedAt: { lte: expiredBefore } }
            ]
        },
        select: { id: true },
        take: BATCH_SIZE,
        orderBy: { sendAt: "asc" }
    });

    for (const candidate of candidates) {
        const token = createToken();
        const claimed = await scheduledMessage.updateMany({
            where: {
                id: candidate.id,
                OR: [
                    { status: "PENDING", sendAt: { lte: now } },
                    { status: "PROCESSING", claimedAt: { lte: expiredBefore } }
                ]
            },
            data: { status: "PROCESSING", claimToken: token, claimedAt: now, attempts: { increment: 1 } }
        });
        if (claimed.count !== 1) continue;

        const stopHeartbeat = startHeartbeat(candidate.id, token);
        try {
            const message = await scheduledMessage.findFirst({
                where: { id: candidate.id, claimToken: token },
                include: { session: true }
            });
            if (!message) continue;

            const sendMessage = getSender(message.session.sessionId);
            if (!sendMessage) {
                await scheduledMessage.updateMany({
                    where: { id: message.id, claimToken: token },
                    data: { status: "PENDING", claimToken: null, claimedAt: null }
                });
                logWarn(`Session ${message.session.sessionId} is disconnected; job ${message.id} returned to PENDING`);
                continue;
            }

            try {
                const content = await buildContent(message);
                await sendMessage(message.jid, content);
            } catch (error) {
                logError(`Scheduled send failed for ${message.id}`, error);
                const retryAt = message.cronExpression
                    ? cronParser.parse(message.cronExpression, { tz: "Asia/Jakarta", currentDate: now }).next().toDate()
                    : undefined;
                await scheduledMessage.updateMany({
                    where: { id: message.id, claimToken: token },
                    data: {
                        status: retryAt ? "PENDING" : "FAILED",
                        sendAt: retryAt,
                        lastError: error instanceof Error ? error.message.slice(0, 2000) : "Send failed",
                        claimToken: null,
                        claimedAt: null
                    }
                });
                continue;
            }

            const nextDate = message.cronExpression
                ? cronParser.parse(message.cronExpression, { tz: "Asia/Jakarta", currentDate: now }).next().toDate()
                : undefined;
            const updated = await scheduledMessage.updateMany({
                where: { id: message.id, claimToken: token },
                data: {
                    status: nextDate ? "PENDING" : "SENT",
                    sendAt: nextDate,
                    lastError: null,
                    claimToken: null,
                    claimedAt: null
                }
            });
            if (updated.count !== 1) {
                logError(`Message ${message.id} was sent, but its lease was lost before state was persisted`);
            }
        } catch (error) {
            // Leave the claim for lease-based recovery if the DB failed after the provider may have accepted it.
            logError(`Processing error for scheduled message ${candidate.id}; lease recovery will retry`, error);
        } finally {
            stopHeartbeat();
        }
    }
    };
}

const processScheduledMessages = createScheduledMessageProcessor({
    scheduledMessage: prisma.scheduledMessage,
    getSender: sessionId => {
        const socket = waManager.getInstance(sessionId)?.socket;
        if (!socket) return undefined;
        return (jid, content) => socket.sendMessage(jid, content);
    },
    buildContent: buildScheduledContent,
    startHeartbeat: (id, token) => heartbeat("scheduledMessage", id, token),
    createToken: randomUUID,
    logError: (message, error) => logger.error("Cron", message, error),
    logWarn: message => logger.warn("Cron", message)
});

async function buildScheduledContent(message: {
    content: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
}) {
    if (!message.mediaUrl) return { text: message.content || "" };

    const { buffer, contentType, fileName } = await safeFetchBuffer(message.mediaUrl, {
        maxBytes: 50 * 1024 * 1024,
        timeoutMs: 15000
    });
    const mediaType = (message.mediaType || "document").toLowerCase();
    const caption = message.content || undefined;
    if (mediaType === "image") return { image: buffer, caption, mimetype: contentType || "image/jpeg" };
    if (mediaType === "video") return { video: buffer, caption, mimetype: contentType || "video/mp4" };
    if (mediaType === "audio") return { audio: buffer, mimetype: contentType || "audio/mpeg" };
    return { document: buffer, caption, mimetype: contentType || "application/octet-stream", fileName: fileName || "file" };
}

type BroadcastLogDelegate = Pick<PrismaClient["broadcastLog"], "findMany" | "updateMany">;
type BroadcastRecipientDelegate = Pick<PrismaClient["broadcastRecipient"], "findFirst" | "updateMany" | "count">;

type BroadcastRecipientProcessorDependencies = {
    broadcastLog: BroadcastLogDelegate;
    broadcastRecipient: BroadcastRecipientDelegate;
    getSender: (sessionId: string) => ((jid: string, content: { text: string }) => Promise<unknown>) | undefined;
    startHeartbeat: (id: string, token: string) => () => void;
    createToken: () => string;
    now: () => Date;
    sleep: (milliseconds: number) => Promise<void>;
    logError: (message: string, error?: unknown) => void;
    emitProgress: (sessionId: string, payload: unknown) => void;
};

/** Creates the broadcast recipient worker with injectable boundaries for deterministic tests. */
export function createBroadcastRecipientProcessor(dependencies: BroadcastRecipientProcessorDependencies) {
    const {
        broadcastLog,
        broadcastRecipient,
        getSender,
        startHeartbeat,
        createToken,
        now: getNow,
        sleep,
        logError,
        emitProgress
    } = dependencies;

    return async function processBroadcastRecipients(now: Date) {
    const expiredBefore = new Date(now.getTime() - LEASE_MS);
    const candidates = await broadcastLog.findMany({
        where: {
            status: "running",
            OR: [{ claimToken: null }, { claimedAt: { lte: expiredBefore } }],
            recipients: {
                some: {
                    OR: [
                        { status: "pending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
                        { status: "processing", claimedAt: { lte: expiredBefore } }
                    ]
                }
            }
        },
        select: { id: true },
        take: BATCH_SIZE,
        orderBy: { startedAt: "asc" }
    });

    for (const candidate of candidates) {
        const logToken = createToken();
        const logClaim = await broadcastLog.updateMany({
            where: { id: candidate.id, status: "running", OR: [{ claimToken: null }, { claimedAt: { lte: expiredBefore } }] },
            data: { claimToken: logToken, claimedAt: now }
        });
        if (logClaim.count !== 1) continue;

        const stopHeartbeat = startHeartbeat(candidate.id, logToken);
        try {
            for (let index = 0; index < BATCH_SIZE; index++) {
                const eligibleAt = getNow();
                const recipientCandidate = await broadcastRecipient.findFirst({
                    where: {
                        broadcastLogId: candidate.id,
                        OR: [
                            { status: "pending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: eligibleAt } }] },
                            { status: "processing", claimedAt: { lte: expiredBefore } }
                        ]
                    },
                    orderBy: { id: "asc" },
                    select: { id: true }
                });
                if (!recipientCandidate) break;

                const token = createToken();
                const claim = await broadcastRecipient.updateMany({
                    where: {
                        id: recipientCandidate.id,
                        broadcastLogId: candidate.id,
                        OR: [
                            { status: "pending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: getNow() } }] },
                            { status: "processing", claimedAt: { lte: expiredBefore } }
                        ]
                    },
                    data: { status: "processing", claimToken: token, claimedAt: getNow(), attempts: { increment: 1 } }
                });
                if (claim.count !== 1) continue;

                const recipient = await broadcastRecipient.findFirst({
                    where: { id: recipientCandidate.id, claimToken: token },
                    include: { broadcastLog: true }
                });
                if (!recipient) continue;
                const sendMessage = getSender(recipient.broadcastLog.sessionId);
                if (!sendMessage) {
                    await broadcastRecipient.updateMany({
                        where: { id: recipient.id, claimToken: token },
                        data: { status: "pending", claimToken: null, claimedAt: null }
                    });
                    break;
                }

                const lastSent = await broadcastRecipient.findFirst({
                    where: { broadcastLogId: recipient.broadcastLogId, status: "sent", sentAt: { not: null } },
                    orderBy: { sentAt: "desc" },
                    select: { sentAt: true }
                });
                if (lastSent?.sentAt) {
                    const baseDelay = Math.max(1000, recipient.broadcastLog.delay);
                    const waitMs = lastSent.sentAt.getTime() + baseDelay - getNow().getTime();
                    if (waitMs > 0) await sleep(waitMs);
                }

                try {
                    await sendMessage(recipient.jid, { text: recipient.broadcastLog.message });
                    await broadcastRecipient.updateMany({
                        where: { id: recipient.id, claimToken: token },
                        data: { status: "sent", sentAt: getNow(), claimToken: null, claimedAt: null, error: null, nextAttemptAt: null }
                    });
                } catch (error) {
                    const shouldRetry = recipient.attempts < 3;
                    const retryDelay = Math.min(5 * 60 * 1000, recipient.broadcastLog.delay * Math.pow(2, recipient.attempts));
                    await broadcastRecipient.updateMany({
                        where: { id: recipient.id, claimToken: token },
                        data: {
                            status: shouldRetry ? "pending" : "failed",
                            nextAttemptAt: shouldRetry ? new Date(getNow().getTime() + retryDelay) : null,
                            error: error instanceof Error ? error.message.slice(0, 2000) : "Send failed",
                            claimToken: null,
                            claimedAt: null
                        }
                    });
                }

                const [sent, failed, pending] = await Promise.all([
                    broadcastRecipient.count({ where: { broadcastLogId: recipient.broadcastLogId, status: "sent" } }),
                    broadcastRecipient.count({ where: { broadcastLogId: recipient.broadcastLogId, status: "failed" } }),
                    broadcastRecipient.count({ where: { broadcastLogId: recipient.broadcastLogId, status: { in: ["pending", "processing"] } } })
                ]);
                const completed = pending === 0;
                await broadcastLog.updateMany({
                    where: { id: recipient.broadcastLogId, claimToken: logToken },
                    data: { sent, failed, ...(completed ? { status: "completed", completedAt: getNow(), claimToken: null, claimedAt: null } : {}) }
                });
                emitProgress(recipient.broadcastLog.sessionId, {
                    broadcastId: recipient.broadcastLogId,
                    status: completed ? "completed" : "running",
                    total: recipient.broadcastLog.total,
                    sent,
                    failed,
                    current: recipient.jid,
                    progress: recipient.broadcastLog.total ? Math.round(((sent + failed) / recipient.broadcastLog.total) * 100) : 100,
                    ...(completed ? { completedAt: getNow().toISOString() } : {})
                });
                if (completed) break;
            }
        } catch (error) {
            logError(`Broadcast processing failed for ${candidate.id}; lease recovery will retry`, error);
        } finally {
            stopHeartbeat();
            await broadcastLog.updateMany({
                where: { id: candidate.id, status: "running", claimToken: logToken },
                data: { claimToken: null, claimedAt: null }
            }).catch(error => logError(`Failed to release broadcast lease ${candidate.id}`, error));
        }
    }
    };
}

const processBroadcastRecipients = createBroadcastRecipientProcessor({
    broadcastLog: prisma.broadcastLog,
    broadcastRecipient: prisma.broadcastRecipient,
    getSender: sessionId => {
        const socket = waManager.getInstance(sessionId)?.socket;
        if (!socket) return undefined;
        return (jid, content) => socket.sendMessage(jid, content);
    },
    startHeartbeat: (id, token) => heartbeat("broadcastLog", id, token),
    createToken: randomUUID,
    now: () => new Date(),
    sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    logError: (message, error) => logger.error("Cron", message, error),
    emitProgress: (sessionId, payload) => {
        (globalThis as typeof globalThis & { io?: SocketEmitter }).io?.to(sessionId).emit("broadcast.progress", payload);
    }
});

export function createSingleFlightRunner(task: () => Promise<void>, onError: (error: unknown) => void) {
    let running = false;
    return async function runOnce() {
        if (running) return;
        running = true;
        try {
            await task();
        } catch (error) {
            onError(error);
        } finally {
            running = false;
        }
    };
}

const runWorker = createSingleFlightRunner(async () => {
    const now = new Date();
    await processScheduledMessages(now);
    await processBroadcastRecipients(now);
}, error => logger.error("Cron", "Scheduler worker failed", error));

/** Start one DB-claimed worker per process. Database leases coordinate replicas. */
export function initScheduler() {
    if (scheduledTask) return;
    scheduledTask = cron.schedule("*/5 * * * * *", () => void runWorker());
    void runWorker();
    logger.info("Cron", "Scheduler initialized with atomic DB claims");
}
