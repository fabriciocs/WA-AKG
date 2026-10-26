import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { waManager } from "@/modules/whatsapp/manager";
import { hashIdempotencyKey, hashTextRequest, type IdempotentTextPayload } from "./idempotency";

export type OperationStatus = "QUEUED" | "PROCESSING" | "SENT" | "FAILED" | "UNKNOWN";

export interface OperationReceipt {
    operationId: string;
    status: OperationStatus;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    messageKey: string | null;
    failureCode: string | null;
}

function toReceipt(operation: {
    id: string; status: string; createdAt: Date; updatedAt: Date; completedAt: Date | null;
    resultMessageKey: string | null; failureCode: string | null;
}): OperationReceipt {
    return {
        operationId: operation.id,
        status: operation.status as OperationStatus,
        createdAt: operation.createdAt.toISOString(),
        updatedAt: operation.updatedAt.toISOString(),
        completedAt: operation.completedAt?.toISOString() ?? null,
        messageKey: operation.resultMessageKey,
        failureCode: operation.failureCode
    };
}

export async function submitIdempotentText(input: {
    userId: string; sessionId: string; jid: string; key: string; payload: IdempotentTextPayload;
}): Promise<{ receipt: OperationReceipt; created: boolean; conflict: boolean }> {
    const session = await prisma.session.findUnique({ where: { sessionId: input.sessionId }, select: { id: true } });
    if (!session) throw new Error("Session not found");

    const idempotencyKeyHash = hashIdempotencyKey(input.key);
    const requestHash = hashTextRequest(input.jid, input.payload);
    const where = { userId_sessionDbId_idempotencyKeyHash: { userId: input.userId, sessionDbId: session.id, idempotencyKeyHash } };
    const existing = await prisma.outboundMessageOperation.findUnique({ where });
    if (existing) {
        return { receipt: toReceipt(existing), created: false, conflict: existing.requestHash !== requestHash };
    }

    try {
        const operation = await prisma.outboundMessageOperation.create({
            data: {
                userId: input.userId,
                sessionDbId: session.id,
                whatsappSessionId: input.sessionId,
                jid: input.jid,
                idempotencyKeyHash,
                requestHash,
                payload: { message: input.payload.message, mentions: input.payload.mentions, quotedMessageId: input.payload.quotedMessageId },
                status: "QUEUED"
            }
        });
        return { receipt: toReceipt(operation), created: true, conflict: false };
    } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
        const raced = await prisma.outboundMessageOperation.findUnique({ where });
        if (!raced) throw error;
        return { receipt: toReceipt(raced), created: false, conflict: raced.requestHash !== requestHash };
    }
}

export async function getOperationReceipt(input: { operationId: string; userId: string; sessionId: string }): Promise<OperationReceipt | null> {
    const session = await prisma.session.findUnique({ where: { sessionId: input.sessionId }, select: { id: true } });
    if (!session) return null;
    const operation = await prisma.outboundMessageOperation.findFirst({
        where: { id: input.operationId, userId: input.userId, sessionDbId: session.id }
    });
    return operation ? toReceipt(operation) : null;
}

let timer: ReturnType<typeof setInterval> | undefined;
let polling = false;

async function markExpiredClaimsUnknown() {
    await prisma.outboundMessageOperation.updateMany({
        where: { status: "PROCESSING", claimExpiresAt: { lt: new Date() } },
        data: { status: "UNKNOWN", failureCode: "WORKER_LEASE_EXPIRED", completedAt: new Date(), claimToken: null }
    });
}

async function processOne(): Promise<boolean> {
    const candidate = await prisma.outboundMessageOperation.findFirst({
        where: { status: "QUEUED", availableAt: { lte: new Date() } },
        orderBy: { createdAt: "asc" }
    });
    if (!candidate) return false;

    const claimToken = randomUUID();
    const claimed = await prisma.outboundMessageOperation.updateMany({
        where: { id: candidate.id, status: "QUEUED" },
        data: { status: "PROCESSING", claimToken, claimedAt: new Date(), claimExpiresAt: new Date(Date.now() + 120_000), attempts: { increment: 1 } }
    });
    if (claimed.count !== 1) return true;

    const current = await prisma.outboundMessageOperation.findUnique({ where: { id: candidate.id } });
    if (!current || current.claimToken !== claimToken) return true;
    const payload = current.payload as unknown as IdempotentTextPayload;
    const instance = waManager.getInstance(current.whatsappSessionId);
    if (!instance?.socket) {
        await prisma.outboundMessageOperation.updateMany({
            where: { id: current.id, status: "PROCESSING", claimToken },
            data: { status: "FAILED", failureCode: "SESSION_DISCONNECTED", completedAt: new Date(), claimToken: null }
        });
        return true;
    }

    const heartbeat = setInterval(() => {
        void prisma.outboundMessageOperation.updateMany({
            where: { id: current.id, status: "PROCESSING", claimToken },
            data: { claimExpiresAt: new Date(Date.now() + 120_000) }
        }).catch(() => undefined);
    }, 30_000);
    heartbeat.unref?.();
    try {
        const result = await ChatService.sendTextMessage(current.whatsappSessionId, current.jid, { text: payload.message }, payload.mentions, payload.quotedMessageId ?? undefined);
        await prisma.outboundMessageOperation.updateMany({
            where: { id: current.id, status: "PROCESSING", claimToken },
            data: { status: "SENT", resultMessageKey: result?.key?.id ?? null, completedAt: new Date(), claimToken: null }
        });
    } catch {
        // Once the provider call starts, its outcome can be ambiguous. Never retry it blindly.
        await prisma.outboundMessageOperation.updateMany({
            where: { id: current.id, status: "PROCESSING", claimToken },
            data: { status: "UNKNOWN", failureCode: "PROVIDER_RESULT_UNKNOWN", completedAt: new Date(), claimToken: null }
        });
    } finally {
        clearInterval(heartbeat);
    }
    return true;
}

async function poll() {
    if (polling) return;
    polling = true;
    try {
        await markExpiredClaimsUnknown();
        for (let count = 0; count < 10; count++) {
            if (!await processOne()) break;
        }
    } catch (error) {
        console.error("Outbound message worker poll failed:", error instanceof Error ? error.message : "unknown error");
    } finally {
        polling = false;
    }
}

export function startOutboundMessageWorker(): () => void {
    if (timer) return () => stopOutboundMessageWorker();
    void poll();
    timer = setInterval(() => void poll(), 1000);
    timer.unref?.();
    return stopOutboundMessageWorker;
}

export function stopOutboundMessageWorker() {
    if (timer) clearInterval(timer);
    timer = undefined;
}
