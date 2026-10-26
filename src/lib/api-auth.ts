import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { NextRequest } from "next/server";
import { auth } from "./auth";
import { logger } from "./logger";
import { authenticateAccessToken } from "./oauth";
import { hasRequiredOAuthScope, normalizeApiPathname, requiredOAuthScopes } from "./oauth/api-policy";
import { resourceMatchesPublicOrigin } from "./oauth/discovery.mjs";

/**
 * Validate API key from request header
 */
export async function validateApiKey(request: NextRequest) {
    const apiKey = request.headers.get("x-api-key");

    if (!apiKey) {
        return null;
    }

    try {
        const user = await prisma.user.findUnique({
            where: { apiKey },
            select: { id: true, email: true, name: true, role: true }
        });

        return user;
    } catch (error) {
        logger.error("Auth", "API key validation error:", error);
        return null;
    }
}

/**
 * Get authenticated user from either session or API key
 */
export async function getAuthenticatedUser(request?: NextRequest) {
    const authorization = request?.headers.get("authorization");
    if (authorization && /^Bearer\s/i.test(authorization)) {
        const token = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
        const principal = token ? await authenticateAccessToken(token) : null;
        if (!principal?.userId) return null;
        if (principal.resource) {
            if (!resourceMatchesPublicOrigin(principal.resource, {
                configuredIssuer: process.env.OAUTH_ISSUER_URL,
                configuredOrigin: process.env.BASE_URL,
                requestOrigin: request!.nextUrl.origin,
            })) return null;
        }

        const pathname = normalizeApiPathname(request!.nextUrl.pathname, process.env.NEXT_PUBLIC_BASE_PATH || "");
        if (!pathname) return null;
        if (/^\/api\/(?:auth(?:\/|$)|user\/api-key(?:\/|$)|users(?:\/|$)|settings\/system(?:\/|$))/.test(pathname)) return null;
        const method = request!.method.toUpperCase();
        const needed = requiredOAuthScopes(method, pathname);
        if (!hasRequiredOAuthScope(principal.scope, needed)) return null;

        if (principal.sessionScope) {
            if (pathname === "/api/sessions") {
                if (method !== "GET") return null;
            }
            const match = pathname.match(/^\/api\/(?:sessions|messages|contacts|groups|webhooks|autoreplies|scheduler|chat|chats|profile|labels|status|system\/monitor)\/([^/]+)/);
            if (!match && pathname !== "/api/sessions") return null;
            if (match) {
                const requestedSession = decodeURIComponent(match[1]);
                const session = await prisma.session.findFirst({
                    where: { OR: [{ id: requestedSession }, { sessionId: requestedSession }] },
                    select: { id: true },
                });
                if (!session || !principal.sessionScope.includes(session.id)) return null;
            }
        }

        const user = await prisma.user.findUnique({
            where: { id: principal.userId },
            select: { id: true, email: true, name: true, role: true },
        });
        if (user) return { ...user, authMethod: "oauth" as const, oauthScopes: principal.scope, oauthSessionScope: principal.sessionScope };
        return null;
    }

    // First try API key if request is provided
    if (request) {
        const apiKeyUser = await validateApiKey(request);
        if (apiKeyUser) {
            return { ...apiKeyUser, authMethod: "apiKey" as const };
        }
    }

    // Fall back to session auth
    const session = await auth();
    if (session?.user?.id) {
        // Fetch full user data including role
        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { id: true, email: true, name: true, role: true }
        });

        if (user) {
            return { ...user, authMethod: "session" as const };
        }
    }

    return null;
}

/**
 * Check if user has required role level
 */
export {
    ROLE_HIERARCHY,
    hasRole,
    isAdmin,
    canAccessSession,
    isSessionOwner,
    getAccessibleSessions
} from "./session-access";
export type { Role } from "./session-access";

/**
 * Generate a cryptographically secure API key
 */
export function generateApiKey(): string {
    // 24 cryptographically secure random bytes encode to 32 URL-safe characters.
    // API keys are bearer credentials; Math.random() is not suitable for secrets.
    return `wag_${randomBytes(24).toString("base64url")}`;
}
