import { z } from "zod";

const recipientSchema = z.string().trim().regex(/^\d{5,15}@s\.whatsapp\.net$/, "Recipient must be a direct WhatsApp phone JID");
export const broadcastBodySchema = z.object({
    recipients: z.array(recipientSchema).min(1).max(500),
    message: z.string().trim().min(1).max(4000),
    delay: z.number().int().min(1000).max(60000).optional()
});

export function normalizeBroadcastInput(input: unknown) {
    const parsed = broadcastBodySchema.safeParse(input);
    if (!parsed.success) return parsed;
    return {
        success: true as const,
        data: { ...parsed.data, recipients: [...new Set(parsed.data.recipients)] }
    };
}
