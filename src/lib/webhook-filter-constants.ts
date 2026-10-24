/** Browser-safe webhook filter options. Keep Prisma message types synchronized with the MessageType enum. */
export const WEBHOOK_PRISMA_MESSAGE_TYPES = [
    "TEXT",
    "IMAGE",
    "VIDEO",
    "AUDIO",
    "DOCUMENT",
    "STICKER",
    "LOCATION",
    "CONTACT",
] as const;

export const WEBHOOK_INTERACTIVE_MESSAGE_TYPES = [
    "INTERACTIVE_RESPONSE",
    "BUTTON_RESPONSE",
    "LIST_RESPONSE",
] as const;

export const WEBHOOK_MESSAGE_TYPES = [...WEBHOOK_PRISMA_MESSAGE_TYPES, ...WEBHOOK_INTERACTIVE_MESSAGE_TYPES] as const;
export const WEBHOOK_CHAT_TYPES = ["PERSONAL", "GROUP", "STATUS", "NEWSLETTER", "UNKNOWN"] as const;

export type WebhookFilters = {
    sessionId?: string;
    senderJid?: string;
    chatJid?: string;
    messageType?: typeof WEBHOOK_MESSAGE_TYPES[number];
    fromMe?: boolean;
    isGroup?: boolean;
    chatType?: typeof WEBHOOK_CHAT_TYPES[number];
};