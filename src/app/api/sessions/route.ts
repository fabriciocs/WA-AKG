import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, getAccessibleSessions } from "@/lib/api-auth";
import { sanitizeOAuthReadSession } from "@/lib/session-access";
import { isValidSessionId } from "@/lib/session-id";
import { getRequestTenantContext, permitsOwnedTenantResource } from "@/lib/tenancy/context";

export const dynamic = 'force-dynamic';

// GET: Fetch sessions (filtered by user role)
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // Get sessions based on user role
        let sessions = await getAccessibleSessions(user, request);
        if (user.authMethod === "oauth" && user.oauthSessionScope) {
            const scope = new Set(user.oauthSessionScope);
            sessions = sessions.filter((item) => scope.has(item.id));
        }
        if (user.authMethod === "oauth") sessions = sessions.map(sanitizeOAuthReadSession);
        return NextResponse.json({ status: true, message: "Sessions retrieved successfully", data: sessions }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("Get sessions error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch sessions", error: "Failed to fetch sessions" }, { status: 500 });
    }
}

// POST: Create new session (always for the authenticated user)
export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const context = await getRequestTenantContext(user, request);
        if (!context || context.actor.tenantRole === "VIEWER" ||
            !permitsOwnedTenantResource(context, { tenantId: context.actor.tenantId, ownerUserId: user.id }, "WRITE")) {
            return NextResponse.json({ status: false, message: "Tenant access denied" }, { status: 403 });
        }

        const body = await request.json();
        const { name, sessionId } = body;

        if (!name) {
            return NextResponse.json({ status: false, message: "Session name is required", error: "Session name is required" }, { status: 400 });
        }

        if (sessionId !== undefined && !isValidSessionId(sessionId)) {
            return NextResponse.json({ status: false, message: "Invalid sessionId", error: "Invalid sessionId" }, { status: 400 });
        }

        // Create session for the authenticated user
        const session = await waManager.createSession(user.id, name, sessionId, context.actor.tenantId);
        return NextResponse.json({ status: true, message: "Session created successfully", data: session });
    } catch (error) {
        console.error("Create session error:", error);
        return NextResponse.json({ status: false, message: "Failed to create session", error: "Failed to create session" }, { status: 500 });
    }
}
