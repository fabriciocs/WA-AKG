import { prisma } from "./prisma";
import type { NextRequest } from "next/server";
import { auth } from "./auth";
import { authenticateAccessToken } from "./oauth";
import { hasRequiredOAuthScope, normalizeApiPathname, requiredOAuthScopes } from "./oauth/api-policy";
import { resourceMatchesPublicOrigin } from "./oauth/discovery.mjs";
import { requestPublicOrigin } from "./base-path";
import { validateApiKeyValue as validateTenantApiKey } from "./tenant-api-keys";

export async function validateApiKeyValue(apiKey: string) {
    try {
        return await validateTenantApiKey(apiKey);
    } catch {
        return null;
    }
}

function matchesCredentialTenant(request: Request, tenantId: string) {
    const selected = request.headers.get("x-tenant-id");
    return selected === null || selected === tenantId;
}

/**
 * Get authenticated user from either session or API key
 */
export async function getAuthenticatedUser(request?: NextRequest) {
    const authorization = request?.headers.get("authorization");
    if (authorization !== undefined && authorization !== null) {
        const token = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
        const principal = token ? await authenticateAccessToken(token) : null;
        if (!principal?.userId || !matchesCredentialTenant(request!, principal.credentialTenantId)) return null;
        if (principal.resource) {
            if (!resourceMatchesPublicOrigin(principal.resource, {
                configuredIssuer: process.env.OAUTH_ISSUER_URL,
                configuredOrigin: process.env.BASE_URL,
                requestOrigin: requestPublicOrigin(request!.headers, request!.url),
            })) return null;
        }

        const pathname = normalizeApiPathname(request!.nextUrl.pathname, "");
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
                    where: { tenantId: principal.credentialTenantId, OR: [{ id: requestedSession }, { sessionId: requestedSession }] },
                    select: { id: true },
                });
                if (!session || !principal.sessionScope.includes(session.id)) return null;
                const capability = principal.sessionCapabilities?.[session.id] ?? "READ";
                if (method !== "GET" && capability !== "WRITE") return null;
            }
        }

        const user = await prisma.user.findUnique({
            where: { id: principal.userId },
            select: { id: true, email: true, name: true, role: true, emailVerified: true },
        });
        if (user?.emailVerified) return {
            ...user, role: "USER" as const, authMethod: "oauth" as const,
            oauthScopes: principal.scope, oauthSessionScope: principal.sessionScope,
            credentialTenantId: principal.credentialTenantId,
        };
        return null;
    }

    const apiKey = request?.headers.get("x-api-key");
    if (apiKey !== undefined && apiKey !== null) {
        const apiKeyUser = await validateApiKeyValue(apiKey);
        if (!apiKeyUser || !matchesCredentialTenant(request!, apiKeyUser.credentialTenantId)) return null;
        const pathname = normalizeApiPathname(request!.nextUrl.pathname, "");
        if (!pathname || !hasRequiredOAuthScope(apiKeyUser.tenantScopes, requiredOAuthScopes(request!.method, pathname))) return null;
        return { ...apiKeyUser, authMethod: "apiKey" as const };
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
