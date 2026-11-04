import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { normalizeBroadcastInput } from "@/lib/broadcast-validation";

import type { Server } from "socket.io";
import { emitSessionRoomEvent } from "@/server/socket";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const rawBody = await request.json();
        const parsed = normalizeBroadcastInput(rawBody);
        if (!parsed.success) {
            return NextResponse.json({ status: false, error: parsed.error.flatten() }, { status: 400 });
        }
        const recipients = parsed.data.recipients;
        const message = parsed.data.message;
        const delay = parsed.data.delay ?? 2000;

        if (!(await canAccessSession(user, request, sessionId))) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        const session = await prisma.session.findFirst({
            where: { OR: [{ id: sessionId }, { sessionId }], tenant: { status: "ACTIVE" } },
            select: { sessionId: true, tenantId: true },
        });
        if (!session?.tenantId) {
            return NextResponse.json({ status: false, error: "Session not found" }, { status: 404 });
        }
        const instance = (await import("@/modules/whatsapp/manager")).waManager.getInstance(session.sessionId);
        if (!instance?.socket || instance.tenantId !== session.tenantId) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        const log = await prisma.broadcastLog.create({
            data: {
                sessionId: session.sessionId,
                tenantId: session.tenantId,
                message,
                total: recipients.length,
                delay,
                status: "running",
                recipients: { create: recipients.map(jid => ({ jid, tenantId: session.tenantId, status: "pending" })) }
            }
        });

        void emitSessionRoomEvent((globalThis as typeof globalThis & { io?: Server }).io, session.tenantId, session.sessionId, "broadcast.progress", {
            broadcastId: log.id,
            status: "running",
            total: recipients.length,
            sent: 0,
            failed: 0,
            current: null,
            progress: 0,
            startedAt: log.startedAt.toISOString()
        });

        return NextResponse.json({
            status: true,
            message: "Broadcast queued",
            data: { broadcastId: log.id, total: recipients.length }
        }, { status: 202 });
    } catch (error) {
        console.error("Broadcast error", error);
        return NextResponse.json({ status: false, message: "Failed to queue broadcast", error: "Failed to queue broadcast" }, { status: 500 });
    }
}
