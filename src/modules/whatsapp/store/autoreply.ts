import { prisma } from "@/lib/prisma";
import type { AnyMessageContent, WASocket } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import type { BotConfig } from "@prisma/client";
import { logger } from "@/lib/logger";

const DEDUPE_TTL_MS = 5 * 60 * 1000;
const processedMessages = new Map<string, number>();
const generatedMessageIds = new Map<string, number>();
const generatedBodies = new Map<string, number>();

function bodySignature(sessionId: string, jid: string, text: string) {
    return `${sessionId}:${jid}:${text}`;
}

function rememberGeneratedBody(sessionId: string, jid: string, text: string) {
    if (text) generatedBodies.set(bodySignature(sessionId, jid, text), Date.now() + DEDUPE_TTL_MS);
}

function rememberOnce(cache: Map<string, number>, key: string) {
    const now = Date.now();
    for (const [cachedKey, expiresAt] of cache) if (expiresAt <= now) cache.delete(cachedKey);
    if (cache.has(key)) return false;
    if (cache.size >= 10000) cache.delete(cache.keys().next().value!);
    cache.set(key, now + DEDUPE_TTL_MS);
    return true;
}

/** Conservative native-RegExp subset: reject long patterns and nested quantified groups. */
export function isSafeAutoReplyRegex(pattern: string) {
    if (!pattern || pattern.length > 128 || /\\[1-9]|\(\?[=!<]/.test(pattern)) return false;
    if (/\([^)]*[+*{][^)]*\)[+*{?]/.test(pattern)) return false;
    if (/\([^)]*\|[^)]*\)[+*{]/.test(pattern)) return false;
    if (/(?:\*|\+|\?){2,}|\{\d{4,}(?:,\d*)?\}/.test(pattern)) return false;
    try {
        new RegExp(pattern, "i");
        return true;
    } catch {
        return false;
    }
}

// Helper for permission check (Deduplicate from command-handler if possible, but keep simple here)
function hasJid(values: unknown, senderJid: string) {
    return Array.isArray(values) && values.some((jid: unknown) => typeof jid === "string" && senderJid.includes(jid));
}

function canAutoReply(config: BotConfig | null, fromMe: boolean, senderJid: string): boolean {
    if (!config || !config.enabled) return false;

    // Auto Reply Specific Mode
    const mode = config.autoReplyMode || 'ALL';

    if (fromMe) {
        // If mode is OWNER, it triggers for ME? 
        // Auto Reply usually replies TO someone. 
        // If I send a message, and mode is OWNER, should it reply to me? 
        // User requested "Self Mode" -> Use case: Snippets.
        // So yes, if fromMe checks out.

        // However, standard auto-reply logic (replying to incoming) should be blocked if fromMe is true AND mode is ALL?
        // No, typically Auto Reply doesn't trigger on own messages to prevent unexpected loops.
        // But for "Self Mode" (Macros), it MUST trigger on own messages.

        if (mode === 'OWNER') return true;
        if (mode === 'ALL') return false; // Standard auto-reply ignores self

        // Specific? 
        return false;
    } else {
        // Incoming message from others
        if (mode === 'OWNER') return false; // Owner only acts on Owner messages
        if (mode === 'ALL') return true;

        if (mode === 'SPECIFIC') {
            return hasJid(config.autoReplyAllowedJids, senderJid);
        }

        if (mode === 'BLACKLIST') {
            return !hasJid(config.autoReplyBlockedJids, senderJid); // Return true if NOT blocked
        }
    }

    return false;
}

export async function bindAutoReply(sock: WASocket, sessionId: string) {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        // Fetch session ID and Bot Config once per batch (optimization)
        const session = await prisma.session.findUnique({
            where: { sessionId },
            include: { botConfig: true }
        });

        if (!session) return;

        let config = session.botConfig;

        if (!config) {
            logger.warn("AutoReply", "No config found, creating default...");
            config = await prisma.botConfig.create({
                data: {
                    sessionId: session.id,
                    enabled: true,
                    botMode: 'OWNER',
                    autoReplyMode: 'ALL'
                }
            });
        }

        logger.debug("AutoReply", `Processing for ${sessionId}. Config: ${config ? "Found" : "Missing"}, ${config?.enabled ? "Enabled" : "Disabled"}`);

        if (!config || !config.enabled) return;

        for (const msg of messages) {
            const fromMe = msg.key.fromMe || false;
            const remoteJid = msg.key.remoteJid;
            const messageId = msg.key.id;
            if (messageId && generatedMessageIds.has(`${sessionId}:${messageId}`)) continue;

            // Standardized Sender Logic
            const isGroup = remoteJid?.endsWith("@g.us") || false;
            const remoteJidAlt = msg.key.remoteJidAlt;
            let senderJid = (isGroup ? (msg.key.participant || msg.participant) : remoteJid);

            if (!isGroup && remoteJidAlt) {
                senderJid = remoteJidAlt;
            }

            if (!remoteJid || !senderJid) continue;

            // Check Permissions
            if (!canAutoReply(config, fromMe, senderJid)) continue;

            const content = normalizeMessageContent(msg.message);
            const text = content?.conversation || content?.extendedTextMessage?.text || ""; // Caption?

            if (fromMe && text) {
                const signature = bodySignature(sessionId, remoteJid, text);
                const expiresAt = generatedBodies.get(signature);
                if (expiresAt && expiresAt > Date.now()) {
                    generatedBodies.delete(signature);
                    continue;
                }
                if (expiresAt) generatedBodies.delete(signature);
            }
            if (messageId && !rememberOnce(processedMessages, `${sessionId}:${messageId}`)) continue;
            if (!text || text.length > 4096) continue;

            try {
                // Fetch rules for this session
                const rules = await prisma.autoReply.findMany({
                    where: {
                        session: {
                            sessionId: sessionId
                        }
                    }
                });

                if (fromMe && config.autoReplyMode !== "OWNER") continue;

                for (const rule of rules) {
                    let match = false;
                    const keyword = rule.keyword.toLowerCase();
                    const incoming = text.toLowerCase();

                    switch (rule.matchType) {
                        case 'EXACT':
                            match = incoming === keyword;
                            break;
                        case 'CONTAINS':
                            match = incoming.includes(keyword);
                            break;
                        case 'REGEX':
                            if (!isSafeAutoReplyRegex(rule.keyword)) {
                                logger.warn("AutoReply", `Rejected unsafe regex rule ${rule.id}`);
                                continue;
                            }
                            match = new RegExp(rule.keyword, 'i').test(text);
                            break;
                    }

                    if (match) {
                        // Check trigger context (GROUP, PRIVATE, or ALL)
                        const isGroup = remoteJid.endsWith('@g.us');
                        const triggerType = rule.triggerType || 'ALL'; // Default to ALL if undefined

                        if (triggerType === 'GROUP' && !isGroup) continue;
                        if (triggerType === 'PRIVATE' && isGroup) continue;

                        logger.info("AutoReply", `Match: ${rule.keyword} -> ${remoteJid}`);

                        if (rule.isMedia && rule.mediaUrl) {
                            const url = rule.mediaUrl;
                            const type = rule.mediaType || "document";
                            
                            try {
                                const { safeFetchBuffer } = await import("@/lib/security");
                                const { buffer, contentType, fileName } = await safeFetchBuffer(url, {
                                    maxBytes: 25 * 1024 * 1024,
                                    timeoutMs: 15000
                                });

                                const caption = rule.response || undefined;
                                const payload: AnyMessageContent = type === "image"
                                    ? { image: buffer, caption, mimetype: contentType || "image/jpeg" }
                                    : type === "video"
                                        ? { video: buffer, caption, mimetype: contentType || "video/mp4" }
                                        : type === "audio"
                                            ? { audio: buffer, mimetype: contentType || "audio/mp4" }
                                            : { document: buffer, caption, mimetype: contentType || "application/octet-stream", fileName: fileName || "document" };

                                rememberGeneratedBody(sessionId, remoteJid, rule.response || "");
                                const outgoing = await sock.sendMessage(remoteJid, payload, { quoted: msg });
                                if (outgoing?.key?.id) rememberOnce(generatedMessageIds, `${sessionId}:${outgoing.key.id}`);
                            } catch (error: unknown) {
                                const message = error instanceof Error ? error.message : "Unknown error";
                                logger.error("AutoReply", `Failed to send media auto-reply: ${message}. Falling back to text if response exists.`);
                                if (rule.response) {
                                    rememberGeneratedBody(sessionId, remoteJid, rule.response);
                                    const outgoing = await sock.sendMessage(remoteJid, { text: rule.response }, { quoted: msg });
                                    if (outgoing?.key?.id) rememberOnce(generatedMessageIds, `${sessionId}:${outgoing.key.id}`);
                                }
                            }
                        } else if (rule.response) {
                            rememberGeneratedBody(sessionId, remoteJid, rule.response);
                            const outgoing = await sock.sendMessage(remoteJid, { text: rule.response }, { quoted: msg });
                            if (outgoing?.key?.id) rememberOnce(generatedMessageIds, `${sessionId}:${outgoing.key.id}`);
                        }

                        break;
                    }
                }

            } catch (error) {
                logger.error("AutoReply", "Error executing auto-reply", error);
            }
        }
    });
}
