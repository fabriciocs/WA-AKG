import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession, isSessionOwner } from "@/lib/api-auth";
import { normalizeWebhookFilters } from "@/lib/webhook-filters";
import { sanitizeWebhookUrl } from "@/lib/webhook-redaction";
import { validateSafeUrl } from "@/lib/security";
import { protectWebhookRequestHeaders, revealWebhookRequestHeaders } from "@/lib/webhook-headers";

type StoredWebhookHeaders = string | null;

/**
 * The transport agent owns header parsing and validation. Keep this adapter
 * local to the API boundary so the persisted value is always validated and
 * protected rather than an unchecked multiline input.
 */
async function validateWebhookUrl(url: unknown, allowLocal: boolean) {
    return validateSafeUrl(url as string, { allowHttp: true, allowLocal });
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(body, key);
}

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
                session: { select: { id: true, sessionId: true, name: true, status: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        const isOwner = await isSessionOwner(user.id, user.role, sessionId);

        const safeWebhooks = webhooks.map(webhook => {
            const safeWebhook = { ...webhook };
            delete (safeWebhook as { secret?: string | null }).secret;
            if (isOwner) {
                safeWebhook.requestHeaders = revealWebhookRequestHeaders(safeWebhook.requestHeaders);
            }
            if (!isOwner) {
                safeWebhook.url = sanitizeWebhookUrl(safeWebhook.url);
                delete (safeWebhook as { requestHeaders?: unknown }).requestHeaders;
            }
            return safeWebhook;
        });
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

    const isOwner = await isSessionOwner(user.id, user.role, sessionId);
    if (!isOwner) {
        return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
    }

    try {
        const body = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ status: false, message: "Invalid request body" }, { status: 400 });
        const { name, url, secret, events } = body;
        const allowLocal = body.allowLocal === undefined ? false : body.allowLocal;
        if (typeof allowLocal !== "boolean") {
            return NextResponse.json({ status: false, message: "allowLocal must be a boolean", error: "allowLocal must be a boolean" }, { status: 400 });
        }

        let requestHeaders: StoredWebhookHeaders = null;
        if (hasOwn(body, "requestHeaders")) {
            const rawHeaders = body.requestHeaders;
            if (rawHeaders !== null && typeof rawHeaders !== "string") {
                return NextResponse.json({ status: false, message: "requestHeaders must be multiline text or null", error: "requestHeaders must be multiline text or null" }, { status: 400 });
            }
            if (typeof rawHeaders === "string" && rawHeaders.trim()) {
                try {
                    requestHeaders = protectWebhookRequestHeaders(rawHeaders);
                } catch (error) {
                    return NextResponse.json({ status: false, message: (error as Error).message }, { status: 400 });
                }
            }
        }

        let filters;
        try { filters = normalizeWebhookFilters(body.filters); }
        catch (error) { return NextResponse.json({ status: false, message: (error as Error).message }, { status: 400 }); }

        if (typeof name !== "string" || !name.trim() || typeof url !== "string" || !events || !Array.isArray(events) || events.length === 0 || !events.every((event: unknown) => typeof event === "string")) {
            return NextResponse.json({ status: false, message: "Name, URL, and at least one event are required", error: "Name, URL, and at least one event are required" }, { status: 400 });
        }

        const urlValidation = await validateWebhookUrl(url, allowLocal);
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
                allowLocal,
                requestHeaders,
                secret: secret || null,
                sessionId: session.id, // Strictly link to this session
                events,
                filters: filters ?? undefined,
                isActive: true
            }
        });

        const safeWebhook = { ...webhook };
        delete (safeWebhook as { secret?: string | null }).secret;
        safeWebhook.requestHeaders = revealWebhookRequestHeaders(webhook.requestHeaders);
        return NextResponse.json({ status: true, message: "Webhook created successfully", data: safeWebhook });
    } catch (error: unknown) {
        console.error("Create webhook error detailed:", error);
        return NextResponse.json({ status: false, message: "Failed to create webhook", error: "Failed to create webhook", details: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
    }
}
