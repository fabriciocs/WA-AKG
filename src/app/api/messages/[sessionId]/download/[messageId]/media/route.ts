import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { readFile } from "node:fs/promises";
import { isSessionMessageMediaFilename, resolvePrivateMediaReference } from "@/lib/private-media";
import { getAuthorizedSession } from "@/lib/session-access";

// GET: Download media from message
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; messageId: string }> }
) {
    const { sessionId, messageId } = await params;
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // Check if user can access this session
        const session = await getAuthorizedSession(user, request, sessionId);
        if (!session) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // Find message in database
        const message = await prisma.message.findUnique({
            where: { id: messageId, sessionId: session.id, tenantId: session.tenantId },
        });

        if (!message) {
            return NextResponse.json({ status: false, message: "Message not found", error: "Message not found" }, { status: 404 });
        }

        if (!message.mediaUrl) {
            return NextResponse.json({ status: false, message: "Message has no media", error: "Message has no media" }, { status: 404 });
        }

        // Persisted media URLs are untrusted, even after checking session ownership.
        // Serve only local files in data/media or redirect to a valid HTTP(S) origin.
        const mediaReference = resolvePrivateMediaReference(message.mediaUrl);
        if (mediaReference.kind === "invalid") {
            return NextResponse.json({ status: false, message: "Media unavailable", error: "Media unavailable" }, { status: 404 });
        }
        if (mediaReference.kind === "external") {
            return NextResponse.redirect(mediaReference.url, { headers: { "Cache-Control": "private, no-store" } });
        }
        if (!isSessionMessageMediaFilename(mediaReference.filename, session.sessionId, message.keyId)) {
            return NextResponse.json({ status: false, message: "Media unavailable", error: "Media unavailable" }, { status: 404 });
        }

        const fileBuffer = await readFile(/* turbopackIgnore: true */ mediaReference.filePath);
        const mimeType = message.type === 'IMAGE' ? 'image/jpeg' 
            : message.type === 'VIDEO' ? 'video/mp4'
            : message.type === 'AUDIO' ? 'audio/mpeg'
            : message.type === 'DOCUMENT' ? 'application/pdf'
            : 'application/octet-stream';

        // Extract filename from path
        const fileName = mediaReference.filename;

        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': mimeType,
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'private, no-store',
            },
        });

    } catch (error) {
        console.error("Download media error:", error);
        return NextResponse.json({ status: false, message: "Failed to download media", error: "Failed to download media" }, { status: 500 });
    }
}
