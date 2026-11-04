import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inboundWebhookEnvelopeSchema } from "@/lib/inbound-event-contract";
import {
    processingResultSchema,
    type ProcessingResultContract,
} from "@/lib/processing-result-contract";

export class ProcessingResultPersistenceError extends Error {
    constructor(
        message: string,
        public readonly statusCode: 400 | 404 | 409,
    ) {
        super(message);
        this.name = "ProcessingResultPersistenceError";
    }
}

export function parseProcessingResult(value: unknown): ProcessingResultContract {
    return processingResultSchema.parse(value);
}

export function processingResultId(eventId: string, jobId: string): string {
    const digest = createHash("sha256").update(`${eventId}:${jobId}`).digest("hex");
    return `res_${digest}`;
}

function asJsonInput(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

function statusForInboundResult(status: ProcessingResultContract["status"]): string {
    return status.toUpperCase();
}

function firstArtifact(result: ProcessingResultContract) {
    return result.artifacts.find((artifact) => artifact.kind === "transcript") ?? result.artifacts[0];
}

export function assertProcessingResultMatchesInbound(
    result: ProcessingResultContract,
    inbound: { jobId: string | null; payload: unknown },
) {
    if (!inbound.jobId || inbound.jobId !== result.jobId) {
        throw new ProcessingResultPersistenceError("Processing job does not match inbound event", 409);
    }

    const envelope = inboundWebhookEnvelopeSchema.parse(inbound.payload);
    if (
        envelope.correlationId !== result.correlationId
        || !result.accessScope.sessionIds.includes(envelope.sessionId)
        || result.accessScope.subjectId !== envelope.authorization.subjectId
    ) {
        throw new ProcessingResultPersistenceError("Processing result authorization scope does not match the inbound event", 409);
    }

    return envelope;
}

export async function persistProcessingResult(value: unknown) {
    const result = parseProcessingResult(value);
    const inbound = await prisma.inboundEvent.findUnique({
        where: { eventId: result.eventId },
        select: {
            eventId: true,
            jobId: true,
            sessionId: true,
            tenantId: true,
            session: { select: { tenantId: true, userId: true, sessionId: true, tenant: { select: { status: true } } } },
            messageId: true,
            message: { select: { sessionId: true, tenantId: true } },
            payload: true,
        },
    });

    if (!inbound?.tenantId || inbound.session.tenantId !== inbound.tenantId || inbound.session.tenant?.status !== "ACTIVE"
        || (inbound.messageId && (inbound.message?.sessionId !== inbound.sessionId || inbound.message?.tenantId !== inbound.tenantId))) {
        throw new ProcessingResultPersistenceError("Inbound event not found", 404);
    }

    const tenantId = inbound.tenantId;
    const envelope = assertProcessingResultMatchesInbound(result, inbound);
    if (envelope.sessionId !== inbound.session.sessionId || envelope.authorization.subjectId !== inbound.session.userId) {
        throw new ProcessingResultPersistenceError("Inbound event tenant binding is invalid", 409);
    }

    const artifact = firstArtifact(result);
    const resultId = processingResultId(result.eventId, result.jobId);
    const stored = await prisma.$transaction(async (tx) => {
        const persisted = await tx.processingResult.upsert({
            where: { eventId_jobId: { eventId: result.eventId, jobId: result.jobId }, tenantId },
            create: {
                id: resultId,
                resultId,
                tenantId,
                contractVersion: result.contractVersion,
                eventId: result.eventId,
                jobId: result.jobId,
                correlationId: result.correlationId,
                sessionId: inbound.sessionId,
                sessionPublicId: envelope.sessionId,
                messageId: inbound.messageId,
                modality: "audio",
                processorVersion: result.processorVersion,
                status: result.status.toUpperCase(),
                language: artifact?.language ?? null,
                text: artifact?.text ?? null,
                evidence: asJsonInput(result.evidence),
                confidence: result.confidence,
                sourceReferences: asJsonInput(result.sourceReferences),
                artifacts: asJsonInput(result.artifacts),
                accessScope: asJsonInput(result.accessScope),
                failureReason: result.failureReason ?? null,
            },
            update: {
                contractVersion: result.contractVersion,
                correlationId: result.correlationId,
                messageId: inbound.messageId,
                processorVersion: result.processorVersion,
                status: result.status.toUpperCase(),
                language: artifact?.language ?? null,
                text: artifact?.text ?? null,
                evidence: asJsonInput(result.evidence),
                confidence: result.confidence,
                sourceReferences: asJsonInput(result.sourceReferences),
                artifacts: asJsonInput(result.artifacts),
                accessScope: asJsonInput(result.accessScope),
                failureReason: result.failureReason ?? null,
            },
        });

        await tx.inboundEvent.update({
            where: { eventId: result.eventId, tenantId },
            data: {
                resultId: persisted.resultId,
                status: statusForInboundResult(result.status),
                processedAt: new Date(),
                claimToken: null,
                claimExpiresAt: null,
                lastError: result.failureReason ?? null,
            },
        });

        return persisted;
    });

    return { result: stored };
}
