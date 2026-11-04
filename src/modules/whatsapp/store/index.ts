import { prisma } from "@/lib/prisma";
import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import type { BotConfig, MessageType, Prisma } from "@prisma/client";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { onMessageReceived, onMessageSent, dispatchWebhook, downloadAndSaveMedia } from "@/lib/webhook";
import { buildInboundWebhookEnvelope, linkInboundEvent, recordInboundEvent } from "../inbound-event.service";
import { handleBotCommand, setSessionStartTime } from "../bot/command-handler";
import { resolveToPhoneJid, isLidJid, normalizeJid } from "@/lib/jid-utils";

import { Server } from "socket.io";
import { logger } from "@/lib/logger";
import { emitSessionRoomEvent } from "@/server/socket";

export const bindSessionStore = (sock: WASocket, sessionId: string, tenantId: string, io: Server | null) => {
    // Set start time for uptime command
    setSessionStartTime(sessionId);

    const getSession = () => prisma.session.findUnique({
        where: { sessionId, tenantId, tenant: { status: "ACTIVE" } },
        select: { id: true },
    });

    // Handle Messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Process all message types: notify, append, and history sync
        if (type !== 'notify' && type !== 'append') {
            // For history sync, we still want to save messages
            logger.debug("Store", `Received ${messages.length} messages of type: ${type}`);
        }

        // Emit to socket room for real-time frontend updates
        if (type === 'notify' || type === 'append') {
            void emitSessionRoomEvent(io, tenantId, sessionId, 'message.upsert', { messages, type });
        }

        const session = await getSession();
        if (!session) return;
        const dbSessionId = session.id;

        type SavedMessage = Awaited<ReturnType<typeof prisma.message.create>>;
        const processedMessages: SavedMessage[] = [];

        // Fetch Bot Config for auto-read & welcome message
        const config = await prisma.botConfig.findUnique({
            where: { sessionId: dbSessionId }
        });

        for (const msg of messages) {
            try {
                // Auto Read Logic
                if (type === 'notify' && config?.autoRead && !msg.key.fromMe) {
                    await sock.readMessages([msg.key]);
                }

                const savedMessage = await processAndSaveMessage(msg, dbSessionId, sessionId, tenantId, type === 'notify', sock, config, io);
                if (savedMessage) {
                    processedMessages.push(savedMessage);
                }

                // Execute Bot Commands (Only for Notify / New Messages)
                if (type === 'notify' && savedMessage) {
                    // Run in background, don't await strictly to not block saving
                    handleBotCommand(sock, sessionId, msg).catch(e => logger.error("Bot", "Bot Handler Error", e));
                }
            } catch (error) {
                logger.error("Store", "Error saving message", error);
            }
        }

        // Emit to socket room for real-time frontend updates
        if (processedMessages.length > 0) {
            // Serialize for frontend: convert Date to ISO string
            const serialized = processedMessages.map((m) => ({
                ...m,
                timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp
            }));
            logger.debug("Socket", `Emitting message.update for ${serialized.length} messages in session ${sessionId}`);
            void emitSessionRoomEvent(io, tenantId, sessionId, 'message.update', serialized);
        }
    });

    // Handle Message History Sync (when connecting for the first time or syncing)
    sock.ev.on('messaging-history.set', async ({ messages, chats, contacts, isLatest }) => {
        logger.info("Store", `History sync: ${messages?.length || 0} messages, ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, latest: ${isLatest}`);

        const session = await getSession();
        if (!session) return;
        const dbSessionId = session.id;

        // Save all historical messages
        if (messages && messages.length > 0) {
            logger.info("Store", `Syncing ${messages.length} historical messages...`);
            for (const msg of messages) {
                try {
                    await processAndSaveMessage(msg, dbSessionId, sessionId, tenantId, false, sock, undefined, io);
                } catch (error) {
                    logger.error("Store", "Error saving historical message", error);
                }
            }
            logger.success("Store", `Finished syncing ${messages.length} historical messages`);
        }


        // Note: Contacts and Chats are synced by src/modules/whatsapp/store/contacts.ts
        // We only handle messages here to avoid P2002 Unique Constraint Race Conditions.
        logger.debug("Store", `Finished syncing messages`);
    });

    // Handle Contacts Upsert
    sock.ev.on('contacts.upsert', async (contacts) => {
        const session = await getSession();
        if (!session) return;
        const dbSessionId = session.id;

        for (const c of contacts) {
            try {
                if (!c.id) continue;
                await prisma.contact.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId, jid: c.id }, tenantId },
                    create: {
                        sessionId: dbSessionId,
                        tenantId,
                        jid: c.id,
                        lid: c.lid || undefined,
                        name: c.name || c.notify || c.verifiedName,
                        notify: c.notify,
                        verifiedName: c.verifiedName,
                        profilePic: c.imgUrl || undefined,
                        data: c as unknown as Prisma.InputJsonValue
                    },
                    update: {
                        lid: c.lid || undefined,
                        name: c.name || undefined,
                        notify: c.notify || undefined,
                        verifiedName: c.verifiedName || undefined,
                        profilePic: c.imgUrl || undefined,
                        data: c as unknown as Prisma.InputJsonValue
                    }
                });

                // Dispatch webhook for contact update
                dispatchWebhook(sessionId, tenantId, "contact.update", { jid: c.id, name: c.name, notify: c.notify });
            } catch (e) {
                logger.error("Store", "Error saving contact", e);
            }
        }
    });

    // Handle Message Status Updates
    sock.ev.on('messages.update', async (updates) => {
        const session = await getSession();
        if (!session) return;
        const dbSessionId = session.id;

        for (const update of updates) {
            try {
                const keyId = update.key?.id;
                if (!keyId) continue;

                const statusMap: Record<number, "PENDING" | "SENT" | "DELIVERED" | "READ"> = {
                    0: 'PENDING',
                    1: 'SENT',
                    2: 'DELIVERED',
                    3: 'READ',
                    4: 'READ', // Played
                };

                const status = statusMap[update.update?.status || 0] || 'PENDING';

                await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, tenantId, keyId },
                    data: { status }
                });

                // Dispatch webhook for message status update
                dispatchWebhook(sessionId, tenantId, "message.status", {
                    keyId,
                    remoteJid: update.key?.remoteJid,
                    status
                });
            } catch (e) {
                logger.error("Store", "Error updating message status", e);
            }
        }
    });

    // Handle Group Updates
    sock.ev.on('groups.update', async (updates) => {
        const session = await getSession();
        if (!session) return;
        const dbSessionId = session.id;

        for (const update of updates) {
            try {
                if (!update.id) continue;
                
                // Keep DB in sync
                const updateData: Prisma.GroupUpdateManyMutationInput = {};
                if (update.subject !== undefined) updateData.subject = update.subject;
                if (update.desc !== undefined) updateData.description = update.desc;
                if (update.restrict !== undefined) updateData.restrict = update.restrict;
                if (update.announce !== undefined) updateData.announce = update.announce;
                if (update.owner !== undefined) updateData.ownerJid = update.owner;
                if (update.linkedParent !== undefined) updateData.linkedParentJid = update.linkedParent;
                if (update.isCommunity !== undefined) updateData.isCommunity = update.isCommunity;

                if (Object.keys(updateData).length > 0) {
                    await prisma.group.updateMany({
                        where: { sessionId: dbSessionId, tenantId, jid: update.id },
                        data: updateData
                    });
                }
                
                // Trigger webhook
                dispatchWebhook(sessionId, tenantId, "group.update", {
                    jid: update.id,
                    ...update
                });
            } catch (e) {
                logger.error("Store", "Error in groups.update handling", e);
            }
        }
    });

    // Handle Group Participants Update
    sock.ev.on('group-participants.update', async (update) => {
        if (!update.id) return;
        const session = await getSession();
        if (!session) return;
        const dbSessionId = session.id;

        try {
            // update.id is the group JID
            // update.participants is array of JIDs
            // update.action is 'add', 'remove', 'promote', 'demote'
            dispatchWebhook(sessionId, tenantId, "group.participant", {
                jid: update.id,
                action: update.action,
                participants: update.participants
            });
            
            // To properly resync the group participants in DB, it's safer to re-fetch the entire group metadata
            // But we don't await strictly to not block the socket
            sock.groupMetadata(update.id).then(async (g) => {
                await prisma.group.updateMany({
                    where: { sessionId: dbSessionId as string, jid: update.id as string },
                    data: { participants: g.participants as unknown as Prisma.InputJsonValue }
                });
            }).catch(e => {
                 logger.debug("Store", "Failed to refresh group participants metadata", e);
            });
        } catch (e) {
            logger.error("Store", "Error in group-participants.update handling", e);
        }
    });
};

async function processAndSaveMessage(
    msg: WAMessage,
    dbSessionId: string,
    sessionId: string,
    tenantId: string,
    triggerWebhook: boolean,
    sock?: WASocket,
    config?: BotConfig | null,
    io?: Server | null
) {
    const keyId = msg.key.id;
    const remoteJid = msg.key.remoteJid;
    const fromMe = msg.key.fromMe;
    const pushName = msg.pushName;
    const timestamp = msg.messageTimestamp
        ? new Date((typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp)) * 1000)
        : new Date();

    // Filter out Protocol & Empty Messages
    if (!msg.message) return false;
    if (!keyId || !remoteJid) return false;

    // Ignore specific technical message types
    const messageKeys = Object.keys(msg.message);

    // Check for message edit/revoke protocol messages FIRST
    if (messageKeys.includes('protocolMessage')) {
        const pMessage = msg.message.protocolMessage;
        const targetKeyId = pMessage?.key?.id;

        // Message Edit (Type 14)
        if (pMessage?.type === 14 && targetKeyId) {
            const editContent = pMessage?.editedMessage;
            if (editContent) {
                // Determine new text
                const normalizedEdit = normalizeMessageContent(editContent);
                let newText = "";
                if (normalizedEdit?.conversation) newText = normalizedEdit.conversation;
                else if (normalizedEdit?.extendedTextMessage?.text) newText = normalizedEdit.extendedTextMessage.text;

                // Update DB safely
                await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, tenantId, keyId: targetKeyId },
                    data: { content: newText } // Note: we don't update timestamp of original
                });

                // Trigger Webhook
                if (triggerWebhook) {
                    dispatchWebhook(sessionId, tenantId, "message.edited", {
                        keyId: targetKeyId,
                        newContent: newText,
                        remoteJid,
                        fromMe
                    });
                }
            }
            return null; // Stop processing as new message
        }

        // Message Revoke/Deleted (Type 0)
        if (pMessage?.type === 0 && targetKeyId) {
            // Check anti-delete config
            let antiDeleteEnabled = false;
            try {
                const s = await prisma.session.findUnique({
                    where: { sessionId, tenantId },
                    select: { config: true }
                });
                const sessionConfig = s?.config;
                antiDeleteEnabled = typeof sessionConfig === "object" && sessionConfig !== null &&
                    "antiDelete" in sessionConfig && sessionConfig.antiDelete === true;
            } catch {}

            if (antiDeleteEnabled) {
                // Anti-delete: read original, keep content, append marker
                const orig = await prisma.message.findFirst({
                    where: { sessionId: dbSessionId, tenantId, keyId: targetKeyId },
                    select: { content: true }
                });
                const preserved = (orig?.content || "") + "\n\n🛡️ [Deleted by sender — preserved]";
                await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, tenantId, keyId: targetKeyId },
                    data: { content: preserved }
                });
                // Re-fetch & re-emit so frontend updates
                const updated = await prisma.message.findFirst({
                    where: { sessionId: dbSessionId, tenantId, keyId: targetKeyId }
                });
                if (updated) {
                    void emitSessionRoomEvent(io, tenantId, sessionId, "message.update", [{
                        ...updated,
                        timestamp: updated.timestamp instanceof Date ? updated.timestamp.toISOString() : updated.timestamp
                    }]);
                }
            } else {
                // Normal: mark as deleted
                await prisma.message.updateMany({
                    where: { sessionId: dbSessionId, tenantId, keyId: targetKeyId },
                    data: { content: "[This message was deleted]", status: "FAILED" }
                });
            }

            // Trigger Webhook
            if (triggerWebhook) {
                dispatchWebhook(sessionId, tenantId, "message.deleted", {
                    keyId: targetKeyId,
                    remoteJid,
                    fromMe
                });
            }
            return null;
        }
    }

    const ignoredTypes = [
        'protocolMessage',
        'senderKeyDistributionMessage',
        'reactionMessage', // Optional: User might want reactions, but usually "kosong" means junk
        'keepInChatMessage'
    ];

    // If message only contains ignored types, skip (since edit and revoke handled above)
    if (messageKeys.every(k => ignoredTypes.includes(k))) {
        logger.debug("Store", `Skipping technical message: ${keyId} (${messageKeys.join(', ')})`);
        return null;
    }

    // Check if message already exists to avoid duplicates
    // Baileys 'notify' event can sometimes trigger multiple times or for history
    // Baileys 'notify' event can sometimes trigger multiple times or for history
    const existingMessage = await prisma.message.findUnique({
        where: { sessionId_keyId: { sessionId: dbSessionId, keyId: keyId! }, tenantId },
        select: { id: true, status: true }
    });

    if (existingMessage) {
        // Message exists! Update status if changed, but DO NOT re-trigger webhooks/bot
        if (fromMe && existingMessage.status !== 'SENT') {
            await prisma.message.update({
                where: { id: existingMessage.id, tenantId },
                data: { status: 'SENT' }
            });
        }
        // Return null to indicate "Not New"
        return null;
    }

    // Record the inbound receipt before any media download or message write.
    // The database uniqueness constraint is the final barrier against races.
    let inboundEventId: string | null = null;
    if (triggerWebhook && !fromMe) {
        const inboundSession = await prisma.session.findUnique({
            where: { id: dbSessionId, tenantId },
            select: { userId: true },
        });

        if (!inboundSession) {
            logger.warn("Store", `Cannot record inbound event: session ${dbSessionId} not found`);
            return null;
        }

        const event = "message.received" as const;
        const payload = buildInboundWebhookEnvelope(sessionId, inboundSession.userId, event, msg);
        const receipt = await recordInboundEvent({
            sessionDbId: dbSessionId,
            tenantId,
            sessionId,
            event,
            data: msg,
            payload,
        });

        if (!receipt.created) {
            if (receipt.conflict) {
                logger.error("Store", `Inbound event conflict for ${payload.eventId}`);
            }
            return null;
        }
        inboundEventId = receipt.event?.eventId ?? null;
    }

    // Debug fromMe issue (Keep this for a while)
    if (fromMe === undefined || fromMe === null) {
        logger.warn("Store", `[DEBUG] Message ${keyId} has fromMe=${fromMe}. Key:`, msg.key);
    }

    const messageContent = normalizeMessageContent(msg.message);
    let text = "";
    let messageType = "TEXT";

    // Check for interactive message (native flow / viewOnce wrapper)
    const rawMsg = msg.message;
    const interactiveMsg = messageContent?.interactiveMessage || 
        rawMsg?.viewOnceMessage?.message?.interactiveMessage || 
        rawMsg?.viewOnceMessageV2?.message?.interactiveMessage;

    // Extract content based on message type
    if (interactiveMsg) {
        messageType = "TEXT";
        const title = interactiveMsg.header?.title ? `*${interactiveMsg.header.title}*\n` : "";
        const body = interactiveMsg.body?.text || "";
        const footer = interactiveMsg.footer?.text ? `\n_${interactiveMsg.footer.text}_` : "";

        let buttonList = "";
        const rawBtns = interactiveMsg.nativeFlowMessage?.buttons || [];
        if (Array.isArray(rawBtns) && rawBtns.length > 0) {
            const btnTitles = rawBtns.map((b) => {
                try {
                    const parsed = typeof b.buttonParamsJson === "string" ? JSON.parse(b.buttonParamsJson) : b.buttonParamsJson;
                    return `[🔘 ${parsed?.display_text || parsed?.title || b.name}]`;
                } catch {
                    return `[🔘 ${b.name}]`;
                }
            });
            buttonList = `\n\n${btnTitles.join("  ")}`;
        }

        text = `${title}${body}${footer}${buttonList}`.trim() || "[Interactive Message]";
    } else if (messageContent?.interactiveResponseMessage) {
        messageType = "TEXT";
        const rm = messageContent.interactiveResponseMessage;
        const nativeParams = rm.nativeFlowResponseMessage?.paramsJson;
        let selectedId = "";
        try {
            if (nativeParams) {
                const parsed = JSON.parse(nativeParams);
                selectedId = parsed.id || parsed.item_id || "";
            }
        } catch {}
        const bodyText = rm.body?.text || "";
        const choice = bodyText || selectedId;
        text = choice ? `🔘 [Interactive Response] ${choice}` : "🔘 [Interactive Response]";
    } else if (messageContent?.buttonsResponseMessage) {
        messageType = "TEXT";
        const bm = messageContent.buttonsResponseMessage;
        const choice = bm.selectedDisplayText || bm.selectedButtonId || "";
        text = choice ? `🔘 [Button Response] ${choice}` : "🔘 [Button Response]";
    } else if (messageContent?.listResponseMessage) {
        messageType = "TEXT";
        const lm = messageContent.listResponseMessage;
        const choice = lm.title || lm.singleSelectReply?.selectedRowId || "";
        text = choice ? `📋 [List Response] ${choice}` : "📋 [List Response]";
    } else if (messageContent?.templateButtonReplyMessage) {
        messageType = "TEXT";
        const tm = messageContent.templateButtonReplyMessage;
        const choice = tm.selectedDisplayText || tm.selectedId || "";
        text = choice ? `🔘 [Button Reply] ${choice}` : "🔘 [Button Reply]";
    } else if (messageContent?.conversation) {
        text = messageContent.conversation;
    } else if (messageContent?.extendedTextMessage?.text) {
        text = messageContent.extendedTextMessage.text;
    } else if (messageContent?.imageMessage) {
        messageType = "IMAGE";
        text = messageContent.imageMessage.caption || "";
    } else if (messageContent?.videoMessage) {
        messageType = "VIDEO";
        text = messageContent.videoMessage.caption || "";
    } else if (messageContent?.audioMessage) {
        messageType = "AUDIO";
    } else if (messageContent?.documentMessage) {
        messageType = "DOCUMENT";
        text = messageContent.documentMessage.fileName || "";
    } else if (messageContent?.stickerMessage) {
        messageType = "STICKER";
    } else if (messageContent?.locationMessage) {
        messageType = "LOCATION";
        text = `${messageContent.locationMessage.degreesLatitude},${messageContent.locationMessage.degreesLongitude}`;
    } else if (messageContent?.contactMessage) {
        messageType = "CONTACT";
        text = messageContent.contactMessage.displayName || "";
    }

    // Determine effective participant for groups
    // Determine effective participant for groups with standard logic
    const isGroup = remoteJid.endsWith("@g.us");
    const remoteJidAlt = msg.key.remoteJidAlt; // LID/Phone JID handling
    let senderJid = fromMe ? undefined : (isGroup ? (msg.key.participant || msg.participant) : remoteJid);

    // Prefer remoteJidAlt for DMs if available (matches webhook logic)
    if (!fromMe && !isGroup && remoteJidAlt) {
        senderJid = remoteJidAlt;
    }

    // --- Normalize LID JIDs to @s.whatsapp.net ---
    let normalizedRemoteJid = remoteJid;
    if (isLidJid(remoteJid)) {
        normalizedRemoteJid = await resolveToPhoneJid(remoteJid, dbSessionId, remoteJidAlt);
    }
    if (senderJid && isLidJid(senderJid)) {
        senderJid = await resolveToPhoneJid(senderJid, dbSessionId, remoteJidAlt);
    }


    // Download Media First (to save URL to DB)
    let fileUrl: string | null = null;
    try {
        fileUrl = await downloadAndSaveMedia(msg, sessionId);
    } catch (e) {
        logger.error("Store", "Error downloading media in store", e);
    }

    // Extract contextInfo (quoted message ID)
    let quoteId: string | null = null;
    if (msg.message) {
        const msgObj = msg.message as unknown as Record<string, unknown>;
        for (const key of Object.keys(msgObj)) {
            const inner = msgObj[key];
            if (inner && typeof inner === 'object' && inner !== null && 'contextInfo' in inner) {
                const contextInfo = inner.contextInfo;
                if (contextInfo && typeof contextInfo === "object" && "stanzaId" in contextInfo && typeof contextInfo.stanzaId === "string") {
                    quoteId = contextInfo.stanzaId;
                    break;
                }
            }
        }
    }

    try {
        const newMessage = await prisma.message.create({
            data: {
                sessionId: dbSessionId,
                tenantId,
                remoteJid: normalizeJid(normalizedRemoteJid),
                senderJid,
                fromMe: fromMe || false,
                keyId,
                pushName,
                type: messageType as MessageType,
                content: text,
                mediaUrl: fileUrl, // Save Media URL
                status: fromMe ? "SENT" : "PENDING",
                timestamp,
                quoteId
            }
        });

        if (inboundEventId) {
            try {
                const linked = await linkInboundEvent(inboundEventId, tenantId, {
                    messageId: newMessage.id,
                    mediaRef: fileUrl,
                });
                if (!linked) {
                    logger.warn("Store", `Inbound event ${inboundEventId} could not be linked to message ${newMessage.id}`);
                }
            } catch (error) {
                logger.error("Store", `Failed to link inbound event ${inboundEventId}`, error);
            }
        }
        
        // Ensure contact exists (Upsert Contact)
        const finalRemoteJid = normalizeJid(normalizedRemoteJid);
        if (remoteJid && !remoteJid.includes('@g.us') && !remoteJid.includes('status@broadcast')) {
            const contactJid = finalRemoteJid; // Use fully normalized JID
            const contactData: Prisma.ContactUncheckedCreateInput = {
                sessionId: dbSessionId,
                jid: contactJid
            };

            // Only update name/notify if message is FROM the contact (not from me)
            if (!fromMe) {
                if (pushName) contactData.notify = pushName;
                if (pushName) contactData.name = pushName;
            }

            await prisma.contact.upsert({
                where: { sessionId_jid: { sessionId: dbSessionId, jid: contactJid }, tenantId },
                create: {
                    sessionId: dbSessionId,
                    tenantId,
                    jid: contactJid,
                    notify: !fromMe ? pushName : undefined,
                    name: !fromMe ? pushName : undefined,
                    remoteJidAlt: remoteJidAlt || undefined
                },
                update: !fromMe ? {
                    notify: pushName,
                    remoteJidAlt: remoteJidAlt || undefined
                } : {}
            });

            // Welcome Message Logic
            if (!fromMe && triggerWebhook && config?.welcomeMessage && sock) {
                // Let's check if message count for this contact is exactly 1 (the one we just saved)
                const msgCount = await prisma.message.count({
                    where: { sessionId: dbSessionId, tenantId, remoteJid: finalRemoteJid }
                });

                if (msgCount === 1) {
                    logger.info("Store", `Sending welcome message to ${finalRemoteJid}`);
                    await sock.sendMessage(finalRemoteJid, { text: config.welcomeMessage });
                }
            }
        }

        // Trigger webhook for new messages only (not history sync)
        if (triggerWebhook) {
            if (fromMe) {
                onMessageSent(sessionId, msg, fileUrl, tenantId).catch(e => logger.error("Webhook", "Error in onMessageSent", e));
            } else {
            onMessageReceived(sessionId, msg, fileUrl, inboundEventId, tenantId).catch(e => logger.error("Webhook", "Error in onMessageReceived", e));
            }
        }

        return newMessage;
    } catch (error: unknown) {
        logger.error("Store", "Error saving message query", error);
        throw error;
    }
}
// Placeholder - verified that I need to find the logic first
