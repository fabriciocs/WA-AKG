/** Fail closed before a queued WhatsApp operation can reach the transport. */
export type OutboundBinding = {
    userId: string;
    tenantId: string | null;
    sessionDbId: string;
    whatsappSessionId: string;
};

export type OutboundSessionBinding = {
    id: string;
    userId: string;
    tenantId: string | null;
    sessionId: string;
    tenant: { status: string } | null;
};

export function isValidOutboundTenantBinding(
    operation: OutboundBinding,
    session: OutboundSessionBinding | null,
): boolean {
    return Boolean(operation.tenantId && session?.tenantId
        && session.tenant?.status === "ACTIVE"
        && operation.tenantId === session.tenantId
        && operation.userId === session.userId
        && operation.sessionDbId === session.id
        && operation.whatsappSessionId === session.sessionId);
}
