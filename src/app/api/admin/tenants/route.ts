import { z } from "zod";
import { withPrivilegedAdministration } from "@/lib/tenancy/privileged";

const newTenantSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  ownerUserId: z.string().min(1).max(191),
}).strict();

export function GET(request: Request) {
  return withPrivilegedAdministration(request, { name: "TENANT_DIRECTORY_READ", action: "READ" }, async (tx) => {
    const tenants = await tx.tenant.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
      select: { id: true, name: true, slug: true, status: true, createdAt: true },
    });
    return { data: { tenants } };
  });
}

export function POST(request: Request) {
  return withPrivilegedAdministration(request, { name: "TENANT_CREATE", action: "MANAGE_TENANT" }, async (tx) => {
    const input = newTenantSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return { status: 400, data: { error: "invalid_request" } };
    const { name, slug, ownerUserId } = input.data;
    const owner = await tx.user.findUnique({ where: { id: ownerUserId }, select: { id: true } });
    if (!owner) return { status: 404, data: { error: "not_found" } };
    const existing = await tx.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (existing) return { status: 409, data: { error: "slug_conflict" } };
    const tenant = await tx.tenant.create({
      data: { name, slug, memberships: { create: { userId: owner.id, role: "OWNER" } } },
      select: { id: true, name: true, slug: true, status: true },
    });
    return { status: 201, tenantId: tenant.id, data: { tenant } };
  });
}
