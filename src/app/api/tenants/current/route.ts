import { NextResponse } from "next/server";
import { TENANT_SELECTION_COOKIE } from "@/lib/tenancy/context";
import { requestPublicOrigin } from "@/lib/base-path";

import {
  badRequestResponse,
  findActiveTenantMembership,
  getTenantSessionUser,
  notFoundResponse,
  parseRequestedTenantId,
  unauthorizedResponse,
} from "@/lib/tenancy/server";

export async function GET(request: Request) {
  const user = await getTenantSessionUser(request);
  if (!user) return unauthorizedResponse();
  if (!request.headers.has("x-tenant-id")) {
    return badRequestResponse("x-tenant-id header is required");
  }

  const tenantId = parseRequestedTenantId(request);
  if (!tenantId) return notFoundResponse();

  const membership = await findActiveTenantMembership(user.id, tenantId);
  if (!membership) return notFoundResponse();

  return NextResponse.json({
    tenant: membership.tenant,
    tenantId: membership.tenantId,
    role: membership.role,
  });
}

export async function POST(request: Request) {
  const user = await getTenantSessionUser(request);
  if (!user) return unauthorizedResponse();
  const origin = requestPublicOrigin(request.headers, request.url);
  if (request.headers.get("origin") !== origin) return notFoundResponse();

  const tenantId = parseRequestedTenantId(request);
  if (!tenantId) return badRequestResponse("A valid x-tenant-id header is required");
  const membership = await findActiveTenantMembership(user.id, tenantId);
  if (membership?.tenantId !== tenantId) return notFoundResponse();

  const response = NextResponse.json({ tenantId }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(TENANT_SELECTION_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https:"),
    path: "/",
  });
  return response;
}
