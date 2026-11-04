import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const allowedStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "BLOCKED"]);

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> },
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const searchParams = new URL(request.url).searchParams;
        const q = searchParams.get("q")?.trim() ?? "";
        const eventId = searchParams.get("eventId")?.trim() || undefined;
        const status = searchParams.get("status")?.trim().toUpperCase() || undefined;
        const modality = searchParams.get("modality")?.trim().toLowerCase() || undefined;
        const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") || "20", 10) || 20, 1), 100);
        const page = Math.max(Number.parseInt(searchParams.get("page") || "1", 10) || 1, 1);
        const skip = (page - 1) * limit;

        if (!q && !eventId) {
            return NextResponse.json({
                status: false,
                error: "At least one of 'q' or 'eventId' is required",
            }, { status: 400 });
        }
        if (status && !allowedStatuses.has(status)) {
            return NextResponse.json({ status: false, error: "Invalid processing result status" }, { status: 400 });
        }

        const canAccess = await canAccessSession(user, request, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true },
        });
        if (!session) {
            return NextResponse.json({ status: false, error: "Session not found" }, { status: 404 });
        }

        const where: Prisma.ProcessingResultWhereInput = {
            sessionId: session.id,
            ...(eventId ? { eventId } : {}),
            ...(status ? { status } : {}),
            ...(modality ? { modality } : {}),
            ...(q ? {
                OR: [
                    { text: { contains: q } },
                    { eventId: { contains: q } },
                    { jobId: { contains: q } },
                    { correlationId: { contains: q } },
                ],
            } : {}),
        };

        const [results, total] = await Promise.all([
            prisma.processingResult.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take: limit,
                skip,
                select: {
                    resultId: true,
                    eventId: true,
                    jobId: true,
                    correlationId: true,
                    sessionPublicId: true,
                    modality: true,
                    processorVersion: true,
                    status: true,
                    language: true,
                    text: true,
                    evidence: true,
                    confidence: true,
                    sourceReferences: true,
                    artifacts: true,
                    accessScope: true,
                    failureReason: true,
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            prisma.processingResult.count({ where }),
        ]);

        return NextResponse.json({
            status: true,
            data: results,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error("Processing result search error", error instanceof Error ? error.message : "unknown error");
        return NextResponse.json({ status: false, error: "Failed to search processing results" }, { status: 500 });
    }
}
