import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { buildProcessingJobView } from "@/lib/processing-job-view";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
        }

        const { jobId } = await params;
        const normalizedJobId = jobId.trim();
        if (!normalizedJobId || normalizedJobId.length > 191) {
            return NextResponse.json({ status: false, error: "Invalid jobId" }, { status: 400 });
        }

        const event = await prisma.inboundEvent.findFirst({
            where: { jobId: normalizedJobId },
            select: {
                eventId: true,
                jobId: true,
                status: true,
                attempts: true,
                receivedAt: true,
                processedAt: true,
                lastError: true,
                mediaRef: true,
                payload: true,
                session: {
                    select: { sessionId: true },
                },
                result: {
                    select: {
                        resultId: true,
                        eventId: true,
                        jobId: true,
                        correlationId: true,
                        contractVersion: true,
                        status: true,
                        processorVersion: true,
                        modality: true,
                        language: true,
                        text: true,
                        evidence: true,
                        confidence: true,
                        sourceReferences: true,
                        artifacts: true,
                        failureReason: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
        });

        if (!event) {
            return NextResponse.json({ status: false, error: "Processing job not found" }, { status: 404 });
        }

        const canAccess = await canAccessSession(user, request, event.session.sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, error: "Forbidden - Cannot access this processing job" }, { status: 403 });
        }

        return NextResponse.json({
            status: true,
            data: {
                sessionId: event.session.sessionId,
                job: buildProcessingJobView(event),
            },
        });
    } catch (error) {
        console.error("Processing job status error", error instanceof Error ? error.message : "unknown error");
        return NextResponse.json({ status: false, error: "Failed to read processing job" }, { status: 500 });
    }
}
