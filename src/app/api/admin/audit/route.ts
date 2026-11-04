import { withPrivilegedAdministration } from "@/lib/tenancy/privileged";
import { parseTenantIdHeader } from "@/lib/tenancy/validation";

export function GET(request: Request) {
  const rawTenantId = new URL(request.url).searchParams.get("tenantId");
  const tenantId = rawTenantId === null ? undefined : parseTenantIdHeader(rawTenantId);
  if (tenantId === null) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return withPrivilegedAdministration(request, { name: "ADMIN_AUDIT_READ", action: "READ", tenantId }, async (tx) => {
    const events = await tx.adminAccessEvent.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
      select: { actorUserId: true, tenantId: true, action: true, reason: true, resourceId: true, requestId: true, outcome: true, createdAt: true },
    });
    return { data: { events } };
  });
}
