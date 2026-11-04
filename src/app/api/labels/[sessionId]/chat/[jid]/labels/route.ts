import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { getAuthorizedSession } from "@/lib/session-access";
import { prisma } from "@/lib/prisma";

// GET: Get labels for a chat
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string, jid: string }> }
) {
    try {
        const { sessionId, jid } = await params;
        const decodedJid = decodeURIComponent(jid);

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        if (!sessionId) {
            return NextResponse.json({ status: false, message: "sessionId is required", error: "sessionId is required" }, { status: 400 });
        }

        // Check if user can access this session
        const session = await getAuthorizedSession(user, request, sessionId);
        if (!session) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const chatLabels = await prisma.chatLabel.findMany({
            where: {
                chatJid: decodedJid,
                tenantId: session.tenantId,
                label: { sessionId: session.sessionId, tenantId: session.tenantId }
            },
            include: {
                label: true
            }
        });

        const labels = chatLabels.map(cl => cl.label);

        return NextResponse.json({ status: true, message: "Operation successful", data: { labels } });

    } catch (error) {
        console.error("Get chat labels error:", error);
        return NextResponse.json({ status: false, message: "Failed to get chat labels", error: "Failed to get chat labels" }, { status: 500 });
    }
}

// PUT: Add or remove labels from chat
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string, jid: string }> }
) {
    try {
        const { sessionId, jid } = await params;
        const decodedJid = decodeURIComponent(jid);
        
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { labelIds, action } = body;

        if (!Array.isArray(labelIds) || !labelIds.every((id) => typeof id === "string" && id.length > 0) || !action) {
            return NextResponse.json({ status: false, message: "labelIds (array), and action are required", error: "labelIds (array), and action are required" }, { status: 400 });
        }

        if (!['add', 'remove'].includes(action)) {
            return NextResponse.json({ status: false, message: "action must be 'add' or 'remove'", error: "action must be 'add' or 'remove'" }, { status: 400 });
        }

        // Check if user can access this session
        const session = await getAuthorizedSession(user, request, sessionId);
        if (!session) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const labelScope = { tenantId: session.tenantId, sessionId: session.sessionId };
        if (action === "add") {
            const labels = await prisma.label.findMany({
                where: { ...labelScope, id: { in: labelIds } },
                select: { id: true },
            });
            if (labels.length > 0) {
                await prisma.chatLabel.createMany({
                    data: labels.map(({ id }) => ({ labelId: id, chatJid: decodedJid, tenantId: session.tenantId })),
                    skipDuplicates: true,
                });
            }
        } else {
            await prisma.chatLabel.deleteMany({
                where: {
                    tenantId: session.tenantId,
                    label: labelScope,
                    labelId: { in: labelIds },
                    chatJid: decodedJid,
                },
            });
        }

        // Get updated labels
        const chatLabels = await prisma.chatLabel.findMany({
            where: {
                chatJid: decodedJid,
                tenantId: session.tenantId,
                label: { sessionId: session.sessionId, tenantId: session.tenantId }
            },
            include: {
                label: true
            }
        });

        const labels = chatLabels.map(cl => cl.label);

        return NextResponse.json({ 
            success: true,
            message: `Labels ${action === 'add' ? 'added to' : 'removed from'} chat`,
            labels
        });

    } catch (error) {
        console.error("Update chat labels error:", error);
        return NextResponse.json({ status: false, message: "Failed to update chat labels", error: "Failed to update chat labels" }, { status: 500 });
    }
}
