import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession, isSessionOwner } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { SAFE_WEBHOOK_SELECT, sanitizeSessionWebhooks, sanitizeSharedSession } from "@/lib/session-access";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const resolvedParams = await params;
        const sessionId = resolvedParams.sessionId;

        // Verify access
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const isOwner = await isSessionOwner(user.id, user.role, sessionId);

        // Get DB Session
        const session = await prisma.session.findUnique({
            where: { sessionId },
            include: {
                botConfig: true,
                webhooks: { select: SAFE_WEBHOOK_SELECT },
                _count: {
                    select: {
                        groups: true,
                        messages: true,
                        contacts: true,
                        autoReplies: true,
                        scheduledMessages: true
                    }
                }
            }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // Get Live Instance Data
        const instance = waManager.getInstance(sessionId);
        const isConnected = instance?.status === "CONNECTED";

        let uptime = 0;
        if (isConnected && instance?.startTime) {
            uptime = Math.floor((new Date().getTime() - instance.startTime.getTime()) / 1000); // in seconds
        }

        let me = null;
        if (isConnected && instance?.socket?.user) {
            me = instance.socket.user;
        }

        return NextResponse.json({
            status: true,
            message: "Session details retrieved successfully",
            data: {
                ...sanitizeSessionWebhooks(isOwner ? session : sanitizeSharedSession(session)),
                status: instance?.status || session.status, // Prefer live status
                uptime,
                me,
                hasInstance: !!instance,
                pairingCode: isOwner ? instance?.pairingCode || null : null
            }
        });

    } catch (error) {
        console.error("Get session details error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}
