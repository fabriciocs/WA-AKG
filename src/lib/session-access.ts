import { prisma } from "./prisma";
import { sanitizeWebhookUrl } from "./webhook-redaction";

// Role hierarchy for permission checks
export const ROLE_HIERARCHY = {
    SUPERADMIN: 3,
    STAFF: 2,
    USER: 1
} as const;

export type Role = keyof typeof ROLE_HIERARCHY;

/** Webhook metadata safe to expose in session responses. Never select `secret`. */
export const SAFE_WEBHOOK_SELECT = {
    id: true,
    userId: true,
    sessionId: true,
    name: true,
    url: true,
    events: true,
    filters: true,
    isActive: true,
    createdAt: true,
    updatedAt: true
} as const;

/** Defense-in-depth serializer for session payloads from current/future queries. */
export function sanitizeSessionWebhooks<T extends { webhooks?: unknown }>(session: T): T {
    if (!Array.isArray(session.webhooks)) return session;
    const webhooks = session.webhooks.map(webhook => {
        if (!webhook || typeof webhook !== "object") return webhook;
        const safeWebhook = { ...(webhook as Record<string, unknown>) };
        delete safeWebhook.secret;
        return safeWebhook;
    });
    return { ...session, webhooks } as T;
}

/** Remove connection credentials from a session shared with a non-owner. */
export function sanitizeSharedSession<T>(session: T): T {
    const safeSession: Record<string, unknown> = { ...(session as object) };
    delete safeSession.qr;

    if (Array.isArray(safeSession.webhooks)) {
        safeSession.webhooks = safeSession.webhooks.map(webhook => {
            if (!webhook || typeof webhook !== "object") return webhook;
            const safeWebhook = { ...(webhook as Record<string, unknown>) };
            if (typeof safeWebhook.url === "string") safeWebhook.url = sanitizeWebhookUrl(safeWebhook.url);
            return safeWebhook;
        });
    }

    const botConfig = safeSession.botConfig;
    if (botConfig && typeof botConfig === "object" && !Array.isArray(botConfig)) {
        const safeBotConfig = { ...(botConfig as Record<string, unknown>) };
        delete safeBotConfig.removeBgApiKey;
        safeSession.botConfig = safeBotConfig;
    }

    return safeSession as T;
}

/** Pure ownership rule used by route guards and their tests. */
export function mayManageSession(userId: string, userRole: string, ownerId: string): boolean {
    return isAdmin(userRole) || userId === ownerId;
}

function safeSessionInclude() {
    return {
        user: { select: { name: true, email: true } },
        botConfig: true,
        webhooks: { select: SAFE_WEBHOOK_SELECT },
        _count: { select: { contacts: true, messages: true, groups: true, autoReplies: true, scheduledMessages: true } }
    };
}

/**
 * Check if user has required role level
 */
export function hasRole(userRole: string, requiredRole: Role): boolean {
    const userLevel = ROLE_HIERARCHY[userRole as Role] || 0;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
    return userLevel >= requiredLevel;
}

/**
 * Check if user is admin (SUPERADMIN or has admin privileges)
 */
export function isAdmin(userRole: string): boolean {
    return userRole === "SUPERADMIN";
}

/**
 * Check if user can access a session
 * - SUPERADMIN can access all sessions
 * - Other users can access their own sessions OR sessions shared with them
 */
export async function canAccessSession(userId: string, userRole: string, sessionId: string): Promise<boolean> {
    if (isAdmin(userRole)) {
        return true;
    }

    // Check if session belongs to user (ownership)
    const session = await prisma.session.findFirst({
        where: {
            OR: [
                { id: sessionId, userId },
                { sessionId: sessionId, userId }
            ]
        }
    });

    if (session) return true;

    // Check if user has shared access
    const dbSession = await prisma.session.findFirst({
        where: {
            OR: [
                { id: sessionId },
                { sessionId: sessionId }
            ]
        },
        select: { id: true }
    });

    if (!dbSession) return false;

    const sharedAccess = await prisma.sessionAccess.findUnique({
        where: {
            sessionId_userId: {
                sessionId: dbSession.id,
                userId
            }
        }
    });

    return !!sharedAccess;
}

/**
 * Check if user is the actual owner of a session (not just shared access)
 * Used for protecting management endpoints (e.g. granting/revoking access)
 */
export async function isSessionOwner(userId: string, userRole: string, sessionId: string): Promise<boolean> {
    if (isAdmin(userRole)) {
        return true;
    }

    const session = await prisma.session.findFirst({
        where: {
            OR: [
                { id: sessionId, userId },
                { sessionId: sessionId, userId }
            ]
        }
    });

    return !!session && mayManageSession(userId, userRole, session.userId);
}

/**
 * Get sessions that user can access
 * - SUPERADMIN sees all
 * - Others see only their own + shared
 */
export async function getAccessibleSessions(userId: string, userRole: string) {
    if (isAdmin(userRole)) {
        const sessions = await prisma.session.findMany({
            orderBy: { createdAt: 'desc' },
            include: safeSessionInclude()
        });
        return sessions.map(sanitizeSessionWebhooks);
    }

    // Get sessions owned by user + sessions shared with user
    const [ownedSessions, sharedAccess] = await Promise.all([
        prisma.session.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: safeSessionInclude()
        }),
        prisma.sessionAccess.findMany({
            where: { userId },
            select: { sessionId: true }
        })
    ]);

    if (sharedAccess.length === 0) return ownedSessions.map(sanitizeSessionWebhooks);

    const sharedSessionIds = sharedAccess.map(a => a.sessionId);
    const ownedIds = new Set(ownedSessions.map(s => s.id));
    const missingIds = sharedSessionIds.filter(id => !ownedIds.has(id));

    if (missingIds.length === 0) return ownedSessions.map(sanitizeSessionWebhooks);

    const sharedSessions = await prisma.session.findMany({
        where: { id: { in: missingIds } },
        orderBy: { createdAt: 'desc' },
        include: safeSessionInclude()
    });

    return [
        ...ownedSessions.map(sanitizeSessionWebhooks),
        ...sharedSessions.map(session => sanitizeSessionWebhooks(sanitizeSharedSession(session)))
    ];
}
