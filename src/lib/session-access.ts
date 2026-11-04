import { prisma } from "./prisma";
import { getRequestTenantContext, permitsOwnedTenantResource, type TenantIdentity } from "./tenancy/context";
import { sanitizeWebhookUrl } from "./webhook-redaction";

// Role hierarchy for permission checks
export const ROLE_HIERARCHY = {
    SUPERADMIN: 3,
    STAFF: 2,
    USER: 1
} as const;

export type Role = keyof typeof ROLE_HIERARCHY;

/**
 * Compatibility decision for the legacy SessionAccess relation.
 *
 * SessionAccess remains in the schema for backwards compatibility, but it no
 * longer grants access to non-owners, including SUPERADMIN. Privileged access
 * requires a separate MFA-verified, audited operation.
 */
export const LEGACY_SESSION_ACCESS_POLICY = "DENY_NON_OWNER" as const;

export type SessionAccessDecision = "OWNER" | "DENIED_LEGACY_SHARED";

/** Resolve the minimum session policy before any database lookup is performed. */
export function resolveSessionAccessDecision(userId: string, _userRole: string, ownerId: string): SessionAccessDecision {
    // Platform administration is never implicit access to another user's private session.
    // Any privileged access must use a separately audited, MFA-verified path.
    if (userId === ownerId) return "OWNER";
    return "DENIED_LEGACY_SHARED";
}

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

const SENSITIVE_CONFIG_KEYS = new Set([
    "apikey", "api_key", "clientsecret", "password", "refreshtoken", "secret",
    "token", "access_token", "accesstoken", "privatekey", "requestheaders", "removebgapikey",
]);

function redactConfigValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactConfigValue);
    if (!value || typeof value !== "object") return value;
    const safe: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (SENSITIVE_CONFIG_KEYS.has(key.toLowerCase().replace(/[-\s]/g, ""))) continue;
        safe[key] = redactConfigValue(nestedValue);
    }
    return safe;
}

/** Remove connection credentials and opaque secrets from an API/OAuth read. */
export function sanitizeReadOnlySession<T>(session: T): T {
    const safeSession: Record<string, unknown> = { ...(session as object) };
    delete safeSession.qr;
    delete safeSession.pairingCode;
    delete safeSession.config;

    if (Array.isArray(safeSession.webhooks)) {
        safeSession.webhooks = safeSession.webhooks.map(webhook => {
            if (!webhook || typeof webhook !== "object") return webhook;
            const safeWebhook = { ...(webhook as Record<string, unknown>) };
            if (typeof safeWebhook.url === "string") safeWebhook.url = sanitizeWebhookUrl(safeWebhook.url);
            delete safeWebhook.secret;
            delete safeWebhook.requestHeaders;
            return safeWebhook;
        });
    }

    const botConfig = safeSession.botConfig;
    if (botConfig !== undefined) safeSession.botConfig = redactConfigValue(botConfig);

    return safeSession as T;
}

/** Remove connection credentials from a session shared with a non-owner. */
export function sanitizeSharedSession<T>(session: T): T {
    return sanitizeReadOnlySession(session);
}

/** Explicit semantic alias for OAuth/API read-only responses. */
export function sanitizeOAuthReadSession<T>(session: T): T {
    return sanitizeReadOnlySession(session);
}

/** Redact known and nested secret keys from a bot configuration response. */
export function sanitizeReadOnlyBotConfig<T>(config: T): T {
    return redactConfigValue(config) as T;
}

/** Pure ownership rule used by route guards and their tests. */
export function mayManageSession(userId: string, _userRole: string, ownerId: string): boolean {
    return userId === ownerId;
}

function safeSessionInclude(tenantId: string) {
    return {
        user: { select: { name: true, email: true } },
        botConfig: { where: { tenantId } },
        webhooks: { where: { tenantId }, select: SAFE_WEBHOOK_SELECT },
        _count: { select: { contacts: { where: { tenantId } }, messages: { where: { tenantId } }, groups: { where: { tenantId } }, autoReplies: { where: { tenantId } }, scheduledMessages: { where: { tenantId } } } }
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

/** Resolve the tenant and owner before any session route performs work. */
export async function getAuthorizedSession(user: TenantIdentity, request: Request, sessionId: string) {
    const context = await getRequestTenantContext(user, request);
    if (!context) return null;

    const matches = await prisma.session.findMany({
        where: {
            OR: [{ id: sessionId }, { sessionId }],
        },
        select: { id: true, sessionId: true, tenantId: true, userId: true },
        take: 2,
    });
    const [session] = matches;
    if (matches.length !== 1 || (session.id !== sessionId && session.sessionId !== sessionId)) return null;
    if (session.userId !== user.id || session.tenantId !== context.actor.tenantId) return null;
    const read = request.method === "GET" || request.method === "HEAD";
    const action = read ? "READ" : request.method === "DELETE" ? "DELETE" : "WRITE";
    return permitsOwnedTenantResource(context, { tenantId: session.tenantId, ownerUserId: session.userId }, action)
        ? { ...session, tenantId: session.tenantId } : null;
}

export async function canAccessSession(user: TenantIdentity, request: Request, sessionId: string): Promise<boolean> {
    return Boolean(await getAuthorizedSession(user, request, sessionId));
}

// Owner-only routes intentionally use the same boundary as other legacy session
// routes. Explicit resource grants require a separate, tenant-aware entry point.
export const isSessionOwner = canAccessSession;

export async function getAccessibleSessions(user: TenantIdentity, request: Request) {
    const context = await getRequestTenantContext(user, request);
    if (!context) return [];
    const tenantId = context.actor.tenantId;
    if (!permitsOwnedTenantResource(context, { tenantId, ownerUserId: user.id }, "READ")) return [];

    const ownedSessions = await prisma.session.findMany({
        where: { userId: user.id, tenantId },
        orderBy: { createdAt: "desc" },
        include: safeSessionInclude(tenantId),
    });
    return ownedSessions.map(sanitizeSessionWebhooks);
}
