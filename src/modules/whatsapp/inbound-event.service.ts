import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
    buildInboundEventIdentity,
    canonicalInboundPayload,
    type InboundModality,
} from "@/lib/inbound-event-identity";
import { inboundWebhookEnvelopeSchema } from "@/lib/inbound-event-contract";

export const INBOUND_EVENT_CONTRACT_VERSION = "wa-akg.event.v1" as const;
export const INBOUND_EVENT_MAX_PAYLOAD_BYTES = 512 * 1024;

export type InboundEventStatus =
    | "RECEIVED"
    | "QUEUED"
    | "PROCESSING"
    | "COMPLETED"
    | "PARTIAL"
    | "FAILED"
    | "BLOCKED"
    | "CANCELLED";

export interface InboundWebhookEnvelope {
    contractVersion: typeof INBOUND_EVENT_CONTRACT_VERSION;
    source: "wa-akg";
    eventId: string;
    correlationId: string;
    originalMessageId: string;
    event: string;
    type: string;
    sessionId: string;
    timestamp: string;
    occurredAt: string;
    modality: InboundModality;
    status: "received";
    sender: { id: string };
    conversation: { id: string; type: "chat" | "group" | "status" | "unknown" };
    authorization: { subjectId: string; sessionId: string; scopes: string[] };
    evidenceStatus: "observed" | "declared" | "inferred" | "unknown";
    data: unknown;
}

export interface RecordInboundEventInput {
    sessionDbId: string;
    tenantId: string;
    sessionId: string;
    event: string;
    data: unknown;
    payload: InboundWebhookEnvelope;
}

export interface RecordInboundEventResult {
    created: boolean;
    conflict: boolean;
    event: Awaited<ReturnType<typeof prisma.inboundEvent.findUnique>>;
}

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(authorization|api[-_]?key|media[-_]?key|password|secret|token|cookie)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactPayload(value: unknown): unknown {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Uint8Array) return REDACTED;
    if (Array.isArray(value)) return value.map(redactPayload);
    if (!isRecord(value)) return value;

    return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
            const isContractAuthorization = key === "authorization" && isRecord(child)
                && typeof child.subjectId === "string"
                && typeof child.sessionId === "string"
                && Array.isArray(child.scopes);
            return [
                key,
                SENSITIVE_KEY.test(key) && !isContractAuthorization ? REDACTED : redactPayload(child),
            ];
        }),
    );
}

function payloadSize(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function asJsonInput(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function makeJobId(): string {
    return `job_${randomUUID()}`;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNestedString(data: unknown, ...keys: string[]): string | undefined {
    if (!isRecord(data)) return undefined;
    for (const key of keys) {
        const value = readString(data[key]);
        if (value) return value;
    }
    return undefined;
}

function conversationType(data: unknown): "chat" | "group" | "status" | "unknown" {
    const chatJid = readNestedString(data, "chatJid", "chat_jid");
    if (chatJid === "status@broadcast") return "status";
    if (chatJid?.endsWith("@g.us")) return "group";
    if (chatJid) return "chat";
    return "unknown";
}

export function buildInboundWebhookEnvelope(
    sessionId: string,
    subjectId: string,
    event: string,
    data: unknown,
    timestamp = new Date().toISOString(),
): InboundWebhookEnvelope {
    const identity = buildInboundEventIdentity(sessionId, event, data);
    const key = isRecord(data) && isRecord(data.key) ? data.key : undefined;
    const sender = isRecord(data) && isRecord(data.sender)
        ? readString(data.sender.id) ?? readString(data.senderJid) ?? readString(data.from)
        : readNestedString(data, "senderJid", "sender", "from");
    const conversation = readNestedString(data, "chatJid", "chat_jid")
        ?? readString(key?.remoteJid)
        ?? "unknown";

    return {
        contractVersion: INBOUND_EVENT_CONTRACT_VERSION,
        source: "wa-akg",
        eventId: identity.eventId,
        correlationId: identity.correlationId,
        originalMessageId: identity.originalMessageId,
        event,
        type: event,
        sessionId,
        timestamp,
        occurredAt: timestamp,
        modality: identity.modality,
        status: "received",
        sender: { id: sender ?? "unknown" },
        conversation: { id: conversation, type: conversationType(data) },
        authorization: {
            subjectId,
            sessionId,
            scopes: ["webhook:dispatch"],
        },
        evidenceStatus: "observed",
        data,
    };
}

export function normalizeInboundEventPayload(payload: InboundWebhookEnvelope): InboundWebhookEnvelope {
    const normalized = redactPayload(payload);
    if (payloadSize(normalized) > INBOUND_EVENT_MAX_PAYLOAD_BYTES) {
        throw new Error(`Inbound event payload exceeds ${INBOUND_EVENT_MAX_PAYLOAD_BYTES} bytes`);
    }
    return inboundWebhookEnvelopeSchema.parse(normalized) as InboundWebhookEnvelope;
}

export async function recordInboundEvent(input: RecordInboundEventInput): Promise<RecordInboundEventResult> {
    const identity = buildInboundEventIdentity(input.sessionId, input.event, input.data);
    const payload = normalizeInboundEventPayload(input.payload);
    const jobId = makeJobId();
    const createData = {
        id: identity.eventId,
        eventId: identity.eventId,
        eventType: input.event,
        sessionId: input.sessionDbId,
        tenantId: input.tenantId,
        originalMessageId: identity.originalMessageId,
        payloadHash: identity.payloadHash,
        payload: asJsonInput(payload),
        status: "RECEIVED" as InboundEventStatus,
        attempts: 0,
        jobId,
    };

    // Replayed WhatsApp events are expected. Let MySQL's unique constraints
    // deduplicate atomically without raising/logging a Prisma P2002 per replay.
    // A count of zero must still be verified against the source identity: an
    // unrelated unique-key collision or an ignored insert is not a duplicate.
    const inserted = await prisma.inboundEvent.createMany({
        data: [createData],
        skipDuplicates: true,
    });
    if (inserted.count === 1) {
        const event = await prisma.inboundEvent.findUnique({ where: { eventId: identity.eventId, tenantId: input.tenantId } });
        if (!event) throw new Error("New inbound event receipt could not be read back");
        return { created: true, conflict: false, event };
    }

    const existing = await prisma.inboundEvent.findFirst({
        where: {
            sessionId: input.sessionDbId,
            tenantId: input.tenantId,
            eventType: input.event,
            originalMessageId: identity.originalMessageId,
        },
    });
    if (!existing) throw new Error("Inbound event insert skipped without an existing source receipt");
    return {
        created: false,
        conflict: existing.payloadHash !== identity.payloadHash,
        event: existing,
    };
}

export async function markInboundEventQueued(eventId: string, tenantId: string): Promise<void> {
    await prisma.inboundEvent.updateMany({
        where: { eventId, tenantId, status: "RECEIVED" },
        data: { status: "QUEUED" },
    });
}

export async function markInboundEventCompleted(eventId: string, tenantId: string): Promise<void> {
    await prisma.inboundEvent.updateMany({
        where: { eventId, tenantId, status: { in: ["RECEIVED", "QUEUED", "PROCESSING"] } },
        data: { status: "COMPLETED", processedAt: new Date(), claimToken: null, claimExpiresAt: null },
    });
}

export async function linkInboundEvent(
    eventId: string,
    tenantId: string,
    input: { messageId?: string | null; mediaRef?: string | null },
): Promise<boolean> {
    const updated = await prisma.inboundEvent.updateMany({
        where: { eventId, tenantId, status: { in: ["RECEIVED", "QUEUED", "PROCESSING"] } },
        data: {
            messageId: input.messageId ?? undefined,
            mediaRef: input.mediaRef ?? undefined,
        },
    });
    return updated.count === 1;
}

export async function markInboundEventFailed(eventId: string, tenantId: string, reason: string): Promise<void> {
    await prisma.inboundEvent.updateMany({
        where: { eventId, tenantId, status: { in: ["RECEIVED", "QUEUED", "PROCESSING"] } },
        data: {
            status: "FAILED",
            attempts: { increment: 1 },
            lastError: reason.slice(0, 2000),
            claimToken: null,
            claimExpiresAt: null,
        },
    });
}

export async function claimInboundEvent(eventId: string, tenantId: string, leaseMs = 5 * 60 * 1000): Promise<string | null> {
    const claimToken = randomUUID();
    const claimed = await prisma.inboundEvent.updateMany({
        where: {
            eventId,
            tenantId,
            status: { in: ["RECEIVED", "QUEUED", "FAILED"] },
            availableAt: { lte: new Date() },
            OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lt: new Date() } }],
        },
        data: {
            status: "PROCESSING",
            attempts: { increment: 1 },
            claimToken,
            claimExpiresAt: new Date(Date.now() + leaseMs),
        },
    });
    return claimed.count === 1 ? claimToken : null;
}

export async function recoverExpiredInboundEvents(limit = 100): Promise<number> {
    const now = new Date();
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 1000);
    const expired = await prisma.inboundEvent.findMany({
        where: {
            tenant: { status: "ACTIVE" },
            status: "PROCESSING",
            claimExpiresAt: { lt: now },
        },
        orderBy: { claimExpiresAt: "asc" },
        take: boundedLimit,
        select: { eventId: true },
    });
    if (expired.length === 0) return 0;

    const recovered = await prisma.inboundEvent.updateMany({
        where: {
            eventId: { in: expired.map((event) => event.eventId) },
            tenant: { status: "ACTIVE" },
            status: "PROCESSING",
            claimExpiresAt: { lt: now },
        },
        data: {
            status: "QUEUED",
            availableAt: now,
            claimToken: null,
            claimExpiresAt: null,
            lastError: "Processing lease expired; event requeued for recovery",
        },
    });
    return recovered.count;
}

export async function requeueInboundEvent(eventId: string, tenantId: string, delayMs = 0): Promise<boolean> {
    const result = await prisma.inboundEvent.updateMany({
        where: { eventId, tenantId, status: { in: ["FAILED", "PARTIAL", "BLOCKED"] } },
        data: {
            status: "QUEUED",
            availableAt: new Date(Date.now() + delayMs),
            claimToken: null,
            claimExpiresAt: null,
            lastError: null,
        },
    });
    return result.count === 1;
}
