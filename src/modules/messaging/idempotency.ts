import { createHash } from "node:crypto";

export interface IdempotentTextPayload {
    message: string;
    mentions: string[];
    quotedMessageId: string | null;
}

export function validateIdempotencyKey(value: string | null): string | null {
    if (value === null || value.length < 1 || value.length > 128 || !/^[\x21-\x7e]+$/.test(value)) {
        return null;
    }
    return value;
}

export function hashIdempotencyKey(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashTextRequest(jid: string, payload: IdempotentTextPayload): string {
    const canonical = JSON.stringify([jid, payload.message, payload.mentions, payload.quotedMessageId]);
    return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function parseIdempotentTextPayload(value: unknown): IdempotentTextPayload | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !["message", "mentions", "quotedMessageId"].includes(key))) return null;
    if (!body.message || typeof body.message !== "object" || Array.isArray(body.message)) return null;
    const message = body.message as Record<string, unknown>;
    if (Object.keys(message).length !== 1 || typeof message.text !== "string" || message.text.trim().length === 0 || message.text.length > 4096) return null;
    if (body.mentions !== undefined && (!Array.isArray(body.mentions) || body.mentions.length > 100 || body.mentions.some(item => typeof item !== "string" || item.length === 0 || item.length > 256))) return null;
    if (body.quotedMessageId !== undefined && (typeof body.quotedMessageId !== "string" || body.quotedMessageId.length === 0 || body.quotedMessageId.length > 191)) return null;
    return {
        message: message.text,
        mentions: (body.mentions as string[] | undefined) || [],
        quotedMessageId: (body.quotedMessageId as string | undefined) || null
    };
}
