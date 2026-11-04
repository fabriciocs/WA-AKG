import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  forbiddenResponse,
  findActiveTenantMembership,
  getTenantSessionUser,
  isManagementRole,
  notFoundResponse,
  parseRequestedTenantId,
  unauthorizedResponse,
} from "@/lib/tenancy/server";

export async function GET(request: Request) {
  const user = await getTenantSessionUser(request);
  if (!user) return unauthorizedResponse();

  const tenantId = parseRequestedTenantId(request);
  if (!tenantId) return notFoundResponse();

  const membership = await findActiveTenantMembership(user.id, tenantId);
  if (!membership) return notFoundResponse();
  if (!isManagementRole(membership.role)) return forbiddenResponse();

  const members = await prisma.tenantMembership.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: { tenantId: true, userId: true, role: true, status: true },
    orderBy: [{ role: "asc" }, { userId: "asc" }],
  });

  return NextResponse.json({ members });
}
