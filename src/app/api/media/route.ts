import { NextRequest, NextResponse } from "next/server";
import { readdir, stat, unlink } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { resolvePrivateMediaReference } from "@/lib/private-media";
import { prisma } from "@/lib/prisma";
import { requestBasePath, withBasePath } from "@/lib/base-path";
import { getRequestTenantContext, permitsOwnedTenantResource } from "@/lib/tenancy/context";

// Media directory — private, NOT in public/
const MEDIA_DIR = path.join(process.cwd(), "data", "media");

/**
 * Extract sessionId and messageKeyId from media filename.
 * Format: {sessionId}-{messageKeyId}.{ext}
 */
function parseFilename(filename: string): { sessionId: string; keyId: string } | null {
    const base = filename.replace(/\.[^.]+$/, "");
    const lastDash = base.lastIndexOf("-");
    if (lastDash <= 0) return null;
    return {
        sessionId: base.substring(0, lastDash),
        keyId: base.substring(lastDash + 1),
    };
}

/**
 * GET /api/media — List media files with full hierarchy: User > Session > Sender
 */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }
    const context = await getRequestTenantContext(user, request);
    if (!context || !permitsOwnedTenantResource(context, { tenantId: context.actor.tenantId, ownerUserId: user.id }, "READ")) {
        return NextResponse.json({ status: false, message: "Tenant access denied" }, { status: 403 });
    }
    const { tenantId } = context.actor;

    try {
        if (!existsSync(MEDIA_DIR)) {
            return NextResponse.json({ status: true, message: "No media directory", data: { files: [], totalSize: 0, totalCount: 0 } });
        }

        // Listing private media is owner-scoped for every role, including SUPERADMIN.
        // Privileged platform operations require their own MFA + audit flow.
        const sessions = await prisma.session.findMany({
            where: { userId: user.id, tenantId },
            include: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { createdAt: "desc" },
        });

        // Map sessionId -> session with owner
        const sessionMap = new Map(sessions.map(s => [s.sessionId, {
            name: s.name,
            ownerName: s.user.name || s.user.email,
            ownerId: s.user.id,
        }]));

        const filenames = (await readdir(MEDIA_DIR)).filter(n => n !== ".gitkeep");

        // Filter by session ownership
        const ownedFiles: { name: string; parsed: { sessionId: string; keyId: string } | null }[] = [];
        for (const name of filenames) {
            const parsed = parseFilename(name);
            if (!parsed) {
                continue;
            }
            // Reject symlinks, traversal and stale files before exposing metadata.
            if (sessionMap.has(parsed.sessionId) &&
                resolvePrivateMediaReference(`/api/media/${name}`).kind === "local") {
                ownedFiles.push({ name, parsed });
            }
        }

        // Batch lookup messages in DB for sender info
        const keyIds = ownedFiles.filter(f => f.parsed).map(f => f.parsed!.keyId);
        const messages = keyIds.length > 0
            ? await prisma.message.findMany({
                where: { tenantId, keyId: { in: keyIds }, sessionId: { in: sessions.map(s => s.id) } },
                select: { keyId: true, mediaUrl: true, remoteJid: true, senderJid: true, pushName: true, fromMe: true, session: { select: { sessionId: true } } },
            })
            : [];
        const messageMap = new Map(messages.map(m => [`${m.session.sessionId}-${m.keyId}`, m]));

        // Build response
        const files = await Promise.all(
            ownedFiles.filter(({ name, parsed }) =>
                parsed && messageMap.get(`${parsed.sessionId}-${parsed.keyId}`)?.mediaUrl === `/api/media/${name}`
            ).map(async ({ name, parsed }) => {
                // Private media remains on disk and must not be traced into the build.
                const filePath = path.join(/* turbopackIgnore: true */ MEDIA_DIR, name);
                const fileStat = await stat(filePath);
                const ext = path.extname(name).toLowerCase();

                let type: "image" | "video" | "audio" | "document" = "document";
                if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) type = "image";
                else if ([".mp4", ".avi", ".mkv", ".mov", ".webm"].includes(ext)) type = "video";
                else if ([".mp3", ".wav", ".ogg", ".opus", ".m4a"].includes(ext)) type = "audio";

                const sessionId = parsed?.sessionId || "unknown";
                const sessionInfo = sessionMap.get(sessionId);

                const msgInfo = parsed ? messageMap.get(`${parsed.sessionId}-${parsed.keyId}`) : null;
                const from = msgInfo?.fromMe
                    ? "Me"
                    : msgInfo?.senderJid || msgInfo?.remoteJid || "Unknown";
                const fromName = msgInfo?.pushName || null;

                return {
                    name,
                    size: fileStat.size,
                    type,
                    ext,
                    sessionId,
                    sessionName: sessionInfo?.name || sessionId,
                    ownerName: sessionInfo?.ownerName || "Unknown",
                    ownerId: sessionInfo?.ownerId || "unknown",
                    from,
                    fromName,
                    fromMe: msgInfo?.fromMe ?? false,
                    createdAt: fileStat.birthtime.toISOString(),
                    modifiedAt: fileStat.mtime.toISOString(),
                    url: withBasePath(`/api/media/${encodeURIComponent(name)}`, requestBasePath(request.headers)),
                };
            })
        );

        files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const totalSize = files.reduce((sum, f) => sum + f.size, 0);

        return NextResponse.json({
            status: true,
            message: "Media files fetched successfully",
            data: {
                files,
                totalSize,
                totalCount: files.length,
            }
        });
    } catch (error: unknown) {
        console.error("Media list error:", error);
        return NextResponse.json({ status: false, message: "Failed to list media", error: "Failed to list media" }, { status: 500 });
    }
}

/**
 * DELETE /api/media — Delete selected media files (only user's own sessions)
 * Body: { filenames: string[] }
 */
export async function DELETE(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }
    const context = await getRequestTenantContext(user, request);
    if (!context || !permitsOwnedTenantResource(context, { tenantId: context.actor.tenantId, ownerUserId: user.id }, "DELETE")) {
        return NextResponse.json({ status: false, message: "Tenant access denied" }, { status: 403 });
    }
    const { tenantId } = context.actor;

    try {
        const body: unknown = await request.json();
        const filenames = body && typeof body === "object" && "filenames" in body
            ? (body as { filenames: unknown }).filenames
            : null;

        if (!Array.isArray(filenames) || filenames.length === 0 || filenames.length > 100) {
            return NextResponse.json({ status: false, message: "Invalid payload", error: "filenames array is required" }, { status: 400 });
        }

        let deleted = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const filename of filenames) {
            if (typeof filename !== "string" || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.[a-zA-Z0-9]{1,10}$/.test(filename)) {
                errors.push("Invalid filename");
                failed++;
                continue;
            }

            // Filename syntax and platform roles alone never authorize deletion.
            const parsed = parseFilename(filename);
            const message = parsed && await prisma.message.findFirst({
                where: { tenantId, mediaUrl: `/api/media/${filename}`, keyId: parsed.keyId, session: { tenantId, userId: user.id, sessionId: parsed.sessionId } },
                select: { id: true },
            });
            if (!message) {
                errors.push(`Forbidden: ${filename}`);
                failed++;
                continue;
            }

            const media = resolvePrivateMediaReference(`/api/media/${filename}`);
            if (media.kind !== "local") {
                errors.push(`Not found: ${filename}`);
                failed++;
                continue;
            }

            try {
                await unlink(media.filePath);
                deleted++;
            } catch {
                errors.push(`Failed to delete: ${filename}`);
                failed++;
            }
        }

        return NextResponse.json({ status: true, message: "Media files processed", data: { deleted, failed, errors } });
    } catch (error: unknown) {
        console.error("Media delete error:", error);
        return NextResponse.json({ status: false, message: "Failed to delete media", error: "Failed to delete media" }, { status: 500 });
    }
}
