import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  conflictResponse,
  getTenantSessionUser,
  isUniqueConstraintError,
  SAFE_TENANT_SELECT,
  unauthorizedResponse,
} from "@/lib/tenancy/server";
import { parseTenantCreateInput } from "@/lib/tenancy/validation";

export async function GET(request: Request) {
  const user = await getTenantSessionUser(request);
  if (!user) return unauthorizedResponse();

  const memberships = await prisma.tenantMembership.findMany({
    where: { userId: user.id, status: "ACTIVE", tenant: { status: "ACTIVE" } },
    select: {
      tenantId: true,
      role: true,
      tenant: { select: SAFE_TENANT_SELECT },
    },
    orderBy: { tenant: { name: "asc" } },
  });

  return NextResponse.json({
    tenants: memberships.map(({ tenant, tenantId, role }) => ({ tenant, tenantId, role })),
  });
}

export async function POST(request: Request) {
  const user = await getTenantSessionUser(request);
  if (!user) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseTenantCreateInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const tenant = await prisma.$transaction(async (transaction) => {
      const createdTenant = await transaction.tenant.create({
        data: { name: parsed.value.name, slug: parsed.value.slug, status: "ACTIVE" },
        select: SAFE_TENANT_SELECT,
      });

      await transaction.tenantMembership.create({
        data: {
          tenantId: createdTenant.id,
          userId: user.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });

      return createdTenant;
    });

    return NextResponse.json({ tenant }, { status: 201 });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) return conflictResponse();
    throw error;
  }
}
