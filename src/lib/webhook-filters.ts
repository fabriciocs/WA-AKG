import { MessageType } from "@prisma/client";
import { WEBHOOK_CHAT_TYPES, WEBHOOK_INTERACTIVE_MESSAGE_TYPES, type WebhookFilters } from "./webhook-filter-constants";
export { WEBHOOK_CHAT_TYPES };
export type { WebhookFilters };

/** Advanced webhook filters. Values are exact matches; configured criteria are ANDed. */
export const WEBHOOK_MESSAGE_TYPES = [...Object.values(MessageType), ...WEBHOOK_INTERACTIVE_MESSAGE_TYPES] as const;

const FILTER_KEYS = new Set(["sessionId", "senderJid", "chatJid", "messageType", "fromMe", "isGroup", "chatType"]);
const MAX_FILTER_LENGTH = { sessionId: 191, senderJid: 512, chatJid: 512 } as const;

/** Null, omitted and blank criteria mean no filter. Throws for malformed/unknown criteria. */
export function normalizeWebhookFilters(input: unknown): WebhookFilters | null {
    if (input === null || input === undefined) return null;
    if (typeof input !== "object" || Array.isArray(input)) throw new Error("Filters must be an object or null");
    const raw = input as Record<string, unknown>;
    for (const key of Object.keys(raw)) if (!FILTER_KEYS.has(key)) throw new Error(`Unknown webhook filter: ${key}`);

    const normalized: WebhookFilters = {};
    for (const key of ["sessionId", "senderJid", "chatJid"] as const) {
        const value = raw[key];
        if (value == null) continue;
        if (typeof value !== "string") throw new Error(`${key} must be a string, null, or omitted`);
        const trimmed = value.trim();
        if (trimmed.length > MAX_FILTER_LENGTH[key]) throw new Error(`${key} must be at most ${MAX_FILTER_LENGTH[key]} characters`);
        if (trimmed) normalized[key] = trimmed;
    }
    if (raw.messageType != null) {
        if (typeof raw.messageType !== "string" || !(WEBHOOK_MESSAGE_TYPES as readonly string[]).includes(raw.messageType)) throw new Error("messageType is invalid");
        normalized.messageType = raw.messageType as WebhookFilters["messageType"];
    }
    for (const key of ["fromMe", "isGroup"] as const) {
        if (raw[key] == null) continue;
        if (typeof raw[key] !== "boolean") throw new Error(`${key} must be a boolean, null, or omitted`);
        normalized[key] = raw[key] as boolean;
    }
    if (raw.chatType != null) {
        if (typeof raw.chatType !== "string" || !(WEBHOOK_CHAT_TYPES as readonly string[]).includes(raw.chatType)) throw new Error("chatType is invalid");
        normalized.chatType = raw.chatType as WebhookFilters["chatType"];
    }
    return Object.keys(normalized).length ? normalized : null;
}

/** PUT contract: omitted preserves stored state; null or {} clears; object replaces. */
export function getWebhookFilterUpdate(body: Record<string, unknown>): { supplied: false } | { supplied: true; value: WebhookFilters | null } {
    if (!Object.prototype.hasOwnProperty.call(body, "filters")) return { supplied: false };
    return { supplied: true, value: normalizeWebhookFilters(body.filters) };
}

function readJid(value: unknown): string | undefined {
    if (typeof value === "string" && value.trim()) return value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && record.id.trim()) return record.id;
    if (typeof record.jid === "string" && record.jid.trim()) return record.jid;
    return undefined;
}

function resolveSenderJid(data: Record<string, unknown>, messageKey: Record<string, unknown>): string | undefined {
    const explicitSenderJid = readJid(data.senderJid);
    if (explicitSenderJid) return explicitSenderJid;
    const sender = data.sender;
    if (sender === "ME") return typeof data.from === "string" && data.from.trim() ? data.from : undefined;
    const senderJid = readJid(sender);
    if (senderJid) return senderJid;
    const participantJid = readJid(messageKey.participant);
    if (participantJid) return participantJid;
    return typeof sender === "string" && sender.trim() ? sender : undefined;
}

/** Event attributes are only read from fields supported by the dispatch payloads. */
export function matchesWebhookFilters(filters: WebhookFilters | null | undefined, payload: { sessionId?: unknown; data?: unknown }): boolean {
    if (!filters) return true;
    const data = payload?.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
    const messageKey = data.key && typeof data.key === "object" ? data.key as Record<string, unknown> : {};
    const values: Record<keyof WebhookFilters, unknown> = {
        sessionId: payload?.sessionId,
        senderJid: resolveSenderJid(data, messageKey),
        chatJid: data.chatJid ?? messageKey.remoteJid ?? data.remoteJid,
        messageType: data.type,
        fromMe: messageKey.fromMe,
        isGroup: data.isGroup,
        chatType: data.chatType,
    };
    return (Object.keys(filters) as (keyof WebhookFilters)[]).every(key => values[key] !== undefined && values[key] !== null && values[key] === filters[key]);
}