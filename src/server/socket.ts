import { Server, Socket } from "socket.io";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { validateApiKeyValue } from "../lib/api-auth";
import { isValidSessionId } from "../lib/session-id";
import { decideTenantAccess } from "../lib/tenant-policy";
import { resolveTenantMembership } from "../lib/tenancy/context";
import { parseTenantIdHeader } from "../lib/tenancy/validation";

const SOCKET_READ_SCOPE = "api:read";

type SocketPrincipal =
    | { userId: string; tenantId: string | null; method: "session"; expiresAt: number }
    | { userId: string; tenantId: string; method: "apiKey"; credentialId: string };

type SessionRoom = "public" | "private";
type SessionBinding = { id: string; userId: string; tenantId: string | null };

export function getSessionPublicRoom(tenantId: string, sessionId: string) {
    return `tenant:${tenantId}:session:public:${sessionId}`;
}

export function getSessionPrivateRoom(tenantId: string, sessionId: string) {
    return `tenant:${tenantId}:session:private:${sessionId}`;
}

export function createPublicConnectionUpdate(status: string) {
    return { status };
}

export function createPrivateConnectionUpdate(
    status: string,
    qr: string | null = null,
    pairingCode: string | null = null
) {
    return { status, qr, pairingCode };
}

function parseCookies(cookieHeader?: string): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const cookie of cookieHeader?.split(";") ?? []) {
        const separator = cookie.indexOf("=");
        if (separator > 0) {
            cookies.set(cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1).trim()));
        }
    }
    return cookies;
}

async function mayReceiveSessionEvent(
    principal: SocketPrincipal | undefined,
    session: SessionBinding,
    visibility: SessionRoom
) {
    if (!session.tenantId || session.tenantId !== principal?.tenantId) return false;
    if (principal.method === "session" && principal.expiresAt <= Date.now()) return false;
    if (principal.method === "apiKey" && visibility === "private") return false;

    const user = await prisma.user.findUnique({
        where: { id: principal.userId },
        select: { id: true, emailVerified: true, role: true },
    });
    if (!user?.emailVerified) return false;

    const membership = await resolveTenantMembership(user.id, session.tenantId);
    if (!membership) return false;

    let scopes: string[] | undefined;
    if (principal.method === "apiKey") {
        const key = await prisma.apiCredential.findFirst({
            where: {
                id: principal.credentialId,
                userId: user.id,
                tenantId: session.tenantId,
                revokedAt: null,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: { scopes: true },
        });
        if (!Array.isArray(key?.scopes)) return false;
        scopes = key.scopes.filter((scope): scope is string => typeof scope === "string");
    }

    const grants = visibility === "public" && session.userId !== user.id
        ? await prisma.resourceGrant.findMany({
            where: { tenantId: session.tenantId, resourceType: "SESSION", resourceId: session.id, principalUserId: user.id },
            select: { principalUserId: true, capabilities: true, revokedAt: true, expiresAt: true },
        })
        : [];
    return decideTenantAccess({
        actor: {
            userId: user.id,
            tenantId: membership.tenantId,
            platformRole: user.role,
            tenantRole: membership.role,
            membershipStatus: "ACTIVE",
            authMethod: principal.method,
        },
        resource: {
            tenantId: session.tenantId,
            ownerUserId: session.userId,
            grants: grants.filter(grant => grant.principalUserId === user.id).map(grant => ({
                ...grant,
                userId: user.id,
                capabilities: Array.isArray(grant.capabilities)
                    ? grant.capabilities.filter((capability): capability is string => typeof capability === "string")
                    : [],
            })),
        },
        action: "READ",
        credentialTenantId: principal.method === "apiKey" ? principal.tenantId : undefined,
        requiredScopes: principal.method === "apiKey" ? [SOCKET_READ_SCOPE] : undefined,
        scopes,
    }).allowed;
}

/** Recheck access on every delivery. Room membership can outlive a credential or grant. */
export async function emitSessionRoomEvent(
    io: Server | null | undefined,
    tenantId: string,
    sessionId: string,
    event: string,
    payload: unknown,
    visibility: SessionRoom = "public",
) {
    if (!io) return;
    try {
        const session = await prisma.session.findUnique({
            where: { sessionId, tenantId },
            select: { id: true, userId: true, tenantId: true },
        });
        if (!session) return;

        const room = visibility === "private"
            ? getSessionPrivateRoom(tenantId, sessionId)
            : getSessionPublicRoom(tenantId, sessionId);
        const recipients = await io.in(room).fetchSockets();
        await Promise.all(recipients.map(async recipient => {
            if (await mayReceiveSessionEvent(recipient.data.principal, session, visibility)) {
                recipient.emit(event, payload);
            } else {
                await recipient.leave(room);
            }
        }));
    } catch (error) {
        logger.error("Socket", "Session event delivery failed", error);
    }
}

export function setupSocket(io: Server) {
    io.use(async (socket: Socket, next) => {
        try {
            const { headers, auth: socketAuth } = socket.handshake;
            const cookies = parseCookies(headers.cookie);
            const requestedTenant = headers["x-tenant-id"] ?? cookies.get("wa-akg-tenant");
            const selectedTenantId = typeof requestedTenant === "string" ? parseTenantIdHeader(requestedTenant) : null;
            if (requestedTenant !== undefined && !selectedTenantId) {
                return next(new Error("Invalid tenant selection"));
            }

            const apiKey = socketAuth?.apiKey ?? headers["x-api-key"];
            if (apiKey !== undefined) {
                const user = typeof apiKey === "string" ? await validateApiKeyValue(apiKey) : null;
                if (!user?.credentialTenantId || !user.tenantCredentialId
                    || (selectedTenantId && selectedTenantId !== user.credentialTenantId)
                    || !user.tenantScopes.includes(SOCKET_READ_SCOPE)) {
                    return next(new Error("Authentication required"));
                }
                socket.data.principal = {
                    userId: user.id,
                    tenantId: user.credentialTenantId,
                    credentialId: user.tenantCredentialId,
                    method: "apiKey",
                } satisfies SocketPrincipal;
                return next();
            }

            const secret = process.env.AUTH_SECRET;
            if (!secret) return next(new Error("Authentication required"));
            const { decode } = await import("next-auth/jwt");
            for (const name of ["authjs.session-token", "__Secure-authjs.session-token", "next-auth.session-token", "__Secure-next-auth.session-token"]) {
                const token = cookies.get(name);
                if (!token) continue;
                const decoded = await decode({ token, secret, salt: name }).catch(() => null);
                if (typeof decoded?.id !== "string" || typeof decoded.exp !== "number") continue;
                const membership = await resolveTenantMembership(decoded.id, selectedTenantId);
                if (selectedTenantId && !membership) return next(new Error("Invalid tenant selection"));
                socket.data.principal = {
                    userId: decoded.id,
                    tenantId: membership?.tenantId ?? null,
                    method: "session",
                    expiresAt: decoded.exp * 1000,
                } satisfies SocketPrincipal;
                return next();
            }
            return next(new Error("Authentication required"));
        } catch (error) {
            logger.error("Socket", "Socket authentication failed", error);
            return next(new Error("Authentication required"));
        }
    });

    io.on("connection", (socket: Socket) => {
        socket.on("join-session", async (sessionId: unknown) => {
            if (!isValidSessionId(sessionId)) {
                socket.emit("error", { message: "Invalid sessionId" });
                return;
            }
            try {
                const principal = socket.data.principal as SocketPrincipal | undefined;
                const session = principal?.tenantId ? await prisma.session.findFirst({
                    where: { tenantId: principal.tenantId, OR: [{ id: sessionId }, { sessionId }] },
                    select: { id: true, sessionId: true, userId: true, tenantId: true },
                }) : null;
                if (!session?.tenantId || !(await mayReceiveSessionEvent(principal, session, "public"))) {
                    socket.emit("error", { message: "Forbidden - Cannot access this session" });
                    return;
                }

                await socket.join(getSessionPublicRoom(session.tenantId, session.sessionId));
                if (principal?.method === "session" && session.userId === principal.userId) {
                    await socket.join(getSessionPrivateRoom(session.tenantId, session.sessionId));
                }
            } catch (error) {
                logger.error("Socket", "Failed to join session room", error);
                socket.emit("error", { message: "Error joining session room" });
            }
        });

        socket.on("join-user-room", async (userId: unknown) => {
            const principal = socket.data.principal as SocketPrincipal | undefined;
            if (principal?.method !== "session" || principal.userId !== userId || principal.expiresAt <= Date.now()) {
                socket.emit("error", { message: "Forbidden - Cannot access other user room" });
                return;
            }
            try {
                const user = await prisma.user.findUnique({
                    where: { id: principal.userId },
                    select: { emailVerified: true },
                });
                if (!user?.emailVerified) {
                    socket.emit("error", { message: "Unauthorized" });
                    return;
                }
                await socket.join(`user:${principal.userId}`);
            } catch (error) {
                logger.error("Socket", "Failed to join notification room", error);
                socket.emit("error", { message: "Error joining user room" });
            }
        });
    });
}
