import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { normalizeWebhookFilters } from "@/lib/webhook-filters";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;

    // Verify access to session
    const hasAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!hasAccess) {
        return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
    }

    try {
        // Resolve session string ID to internal ID if needed, or just look up webhooks
        // We need the internal ID to query the Webhook table
        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const webhooks = await prisma.webhook.findMany({
            where: {
                OR: [
                    { sessionId: session.id }, // Specific to this session (anyone who created it)
                    { sessionId: null, userId: user.id } // User's own global webhooks
                ]
            },
            include: {
                session: true
            },
            orderBy: { createdAt: 'desc' }
        });

        const safeWebhooks = webhooks.map(({ secret: _secret, ...webhook }) => webhook);
        return NextResponse.json({ status: true, message: "Webhooks retrieved successfully", data: safeWebhooks });
    } catch (error) {
        console.error("Fetch webhooks error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch webhooks", error: "Failed to fetch webhooks" }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;

    const hasAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!hasAccess) {
        return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
    }

    try {
        const body = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ status: false, message: "Invalid request body" }, { status: 400 });
        const { name, url, secret, events } = body;
        let filters;
        try { filters = normalizeWebhookFilters(body.filters); }
        catch (error) { return NextResponse.json({ status: false, message: (error as Error).message }, { status: 400 }); }

        if (typeof name !== "string" || !name.trim() || typeof url !== "string" || !events || !Array.isArray(events) || events.length === 0 || !events.every((event: unknown) => typeof event === "string")) {
            return NextResponse.json({ status: false, message: "Name, URL, and at least one event are required", error: "Name, URL, and at least one event are required" }, { status: 400 });
        }

        const { validateSafeUrl } = await import("@/lib/security");
        const urlValidation = await validateSafeUrl(url, { allowHttp: false });
        if (!urlValidation.valid) {
            return NextResponse.json({ status: false, message: `Invalid webhook URL: ${urlValidation.error}`, error: urlValidation.error }, { status: 400 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const webhook = await prisma.webhook.create({
            data: {
                userId: user.id,
                name,
                url,
                secret: secret || null,
                sessionId: session.id, // Strictly link to this session
                events,
                filters: filters ?? undefined,
                isActive: true
            }
        });

        const { secret: _secret, ...safeWebhook } = webhook;
        return NextResponse.json({ status: true, message: "Webhook created successfully", data: safeWebhook });
    } catch (error: unknown) {
        console.error("Create webhook error detailed:", error);
        return NextResponse.json({ status: false, message: "Failed to create webhook", error: "Failed to create webhook", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
    }
}
