import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { parseTenantIdHeader } from "./validation";

export const SAFE_TENANT_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

type TenantSessionUser = { id: string };
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

/**
 * Require a real browser session for tenant administration. Do not fall back
 * to API keys, OAuth or MCP credentials, even for platform superadmins.
 */
export async function getTenantSessionUser(request: Request): Promise<TenantSessionUser | null> {
  if (request.headers.has("authorization") || request.headers.has("x-api-key")) return null;
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, emailVerified: true },
  });
  return user?.emailVerified ? { id: user.id } : null;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}

export function badRequestResponse(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

export function notFoundResponse(): NextResponse {
  return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "Tenant access denied" }, { status: 403 });
}

export function conflictResponse(): NextResponse {
  return NextResponse.json({ error: "Tenant slug already exists" }, { status: 409 });
}

export function parseRequestedTenantId(request: Request): string | null {
  return parseTenantIdHeader(request.headers.get("x-tenant-id"));
}

export async function findActiveTenantMembership(userId: string, tenantId: string) {
  return prisma.tenantMembership.findFirst({
    where: {
      tenantId,
      userId,
      status: "ACTIVE",
      tenant: { status: "ACTIVE" },
    },
    select: {
      tenantId: true,
      role: true,
      status: true,
      tenant: { select: SAFE_TENANT_SELECT },
    },
  });
}

export function isManagementRole(role: unknown): role is "OWNER" | "ADMIN" {
  return role === "OWNER" || role === "ADMIN";
}

export function isUniqueConstraintError(error: unknown): boolean {
  return asRecord(error)?.code === "P2002";
}
