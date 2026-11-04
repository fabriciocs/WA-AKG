import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { isSessionMessageMediaFilename, resolvePrivateMediaReference } from "@/lib/private-media";
import { getRequestTenantContext, permitsOwnedTenantResource } from "@/lib/tenancy/context";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    try {
        // Authentication check — require session or API key
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { filename } = await params;

        // Security: Prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return NextResponse.json({ status: false, message: "Invalid filename", error: "Invalid filename" }, { status: 400 });
        }

        // Filenames are not authorization evidence. Require an actual message
        // bound to a session, then enforce ownership before touching the file.
        const context = await getRequestTenantContext(user, request);
        if (!context || !permitsOwnedTenantResource(context, { tenantId: context.actor.tenantId, ownerUserId: user.id }, "READ")) {
            return NextResponse.json({ status: false, message: "Tenant access denied" }, { status: 403 });
        }
        const { tenantId } = context.actor;
        const messages = await prisma.message.findMany({
            where: { mediaUrl: `/api/media/${filename}`, tenantId, session: { tenantId, userId: user.id } },
            select: { keyId: true, mediaUrl: true, session: { select: { sessionId: true } } },
        });
        if (!messages.some((message) => message.mediaUrl === `/api/media/${filename}` &&
            isSessionMessageMediaFilename(filename, message.session.sessionId, message.keyId))) {
            return NextResponse.json({ status: false, message: "File not found", error: "File not found" }, { status: 404 });
        }

        const media = resolvePrivateMediaReference(`/api/media/${filename}`);
        if (media.kind !== "local") {
            return NextResponse.json({ status: false, message: "File not found", error: "File not found" }, { status: 404 });
        }
        const fileBuffer = await readFile(/* turbopackIgnore: true */ media.filePath);

        // Determine content type based on extension
        const ext = path.extname(filename).toLowerCase();
        const contentTypeMap: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.opus': 'audio/opus',
            '.m4a': 'audio/mp4',
            '.pdf': 'application/pdf',
            '.bin': 'application/octet-stream',
        };

        const contentType = contentTypeMap[ext] || 'application/octet-stream';

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `inline; filename="${filename}"`,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        });

    } catch (error: unknown) {
        console.error("Media serve error:", error);
        return NextResponse.json({ status: false, message: "Failed to serve media", error: "Failed to serve media" }, { status: 500 });
    }
}
