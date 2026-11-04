import { z } from "zod";
import { withPrivilegedAdministration } from "@/lib/tenancy/privileged";
import { parseTenantIdHeader } from "@/lib/tenancy/validation";

const updateTenantSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
}).strict().refine((value) => value.name !== undefined || value.status !== undefined);
const select = {
  id: true, name: true, slug: true, status: true, suspendedAt: true,
  _count: { select: { memberships: true, sessions: true } },
} as const;

type Params = { params: Promise<{ tenantId: string }> };

export async function GET(request: Request, { params }: Params) {
  const tenantId = parseTenantIdHeader((await params).tenantId);
  if (!tenantId) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return withPrivilegedAdministration(request, { name: "TENANT_READ", action: "READ", tenantId }, async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select });
    return tenant ? { data: { tenant } } : { status: 404, data: { error: "not_found" } };
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const tenantId = parseTenantIdHeader((await params).tenantId);
  if (!tenantId) return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return withPrivilegedAdministration(request, { name: "TENANT_UPDATE", action: "MANAGE_TENANT", tenantId }, async (tx) => {
    const input = updateTenantSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return { status: 400, data: { error: "invalid_request" } };
    const { name, status } = input.data;
    const result = await tx.tenant.updateMany({
      where: { id: tenantId, status: { in: ["ACTIVE", "SUSPENDED"] } },
      data: { name, status, suspendedAt: status === undefined ? undefined : status === "ACTIVE" ? null : new Date() },
    });
    if (!result.count) return { status: 409, data: { error: "invalid_status_transition" } };
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select });
    return { data: { tenant } };
  });
}
