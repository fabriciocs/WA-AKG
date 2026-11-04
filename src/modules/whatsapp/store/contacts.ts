import { prisma } from "@/lib/prisma";
import type { WASocket } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

/**
 * Sync contacts from WhatsApp to database.
 * Uses proper Baileys events for syncing and correct Session.id foreign key.
 */
export function bindContactSync(sock: WASocket, sessionId: string, tenantId: string) {
    const getSession = () => prisma.session.findUnique({
        where: { sessionId, tenantId, tenant: { status: "ACTIVE" } },
        select: { id: true },
    });

    // Handle contacts.update event (fires when contacts are updated)
    sock.ev.on('contacts.update', async (updates) => {
        const session = await getSession();
        if (!session) return;
        const dbSessionId = session.id;
        
        logger.debug("Store", `Received ${updates.length} contact updates for session ${sessionId}`);
        for (const update of updates) {
            try {
                if (!update.id) continue;
                
                await prisma.contact.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId, jid: update.id }, tenantId },
                    create: {
                        sessionId: dbSessionId,
                        tenantId,
                        jid: update.id,
                        name: update.name || update.notify,
                        notify: update.notify,
                        profilePic: update.imgUrl
                    },
                    update: {
                        name: update.name || undefined,
                        notify: update.notify || undefined,
                        profilePic: update.imgUrl || undefined
                    }
                });
            } catch (e) {
                logger.error("Store", `Failed to sync contact ${update.id}`, e);
            }
        }
    });

    // Also listen for messaging events to auto-create contacts
    sock.ev.on('messaging-history.set', async ({ chats, contacts, messages }) => {
        const session = await getSession();
        if (!session) return;
        const dbSessionId = session.id;
        
        logger.info("Store", `Received messaging history: ${chats.length} chats, ${contacts?.length || 0} contacts, ${messages.length} messages`);
        
        // Sync chats as contacts (for personal chats)
        for (const chat of chats) {
            try {
                if (!chat.id || chat.id.includes('@g.us') || chat.id.includes('@broadcast')) continue;
                
                const notify = "notify" in chat && typeof chat.notify === "string" ? chat.notify : undefined;
                await prisma.contact.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId, jid: chat.id }, tenantId },
                    create: {
                        sessionId: dbSessionId,
                        tenantId,
                        jid: chat.id,
                        name: chat.name || undefined,
                        notify
                    },
                    update: {
                        name: chat.name || undefined
                    }
                });
            } catch (e) {
                logger.error("Store", `Failed to sync chat contact ${chat.id}`, e);
            }
        }
        
        // Sync explicit contacts
        if (contacts) {
            for (const contact of contacts) {
                try {
                    if (!contact.id) continue;
                    
                    await prisma.contact.upsert({
                        where: { sessionId_jid: { sessionId: dbSessionId, jid: contact.id }, tenantId },
                        create: {
                            sessionId: dbSessionId,
                            tenantId,
                            jid: contact.id,
                            name: contact.name || contact.notify,
                            notify: contact.notify
                        },
                        update: {
                            name: contact.name || undefined,
                            notify: contact.notify || undefined
                        }
                    });
                } catch (e) {
                    logger.error("Store", `Failed to sync contact ${contact.id}`, e);
                }
            }
        }
        
        logger.success("Store", `Synced contacts from messaging history for session ${sessionId}`);
    });
}
