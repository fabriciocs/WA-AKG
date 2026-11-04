import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decideTenantAccess, type TenantActor, type TenantAction } from "@/lib/tenant-policy";
import { parseTenantIdHeader } from "./validation";

export const TENANT_SELECTION_COOKIE = "wa-akg-tenant";

export function personalTenantId(userId: string): string {
  return `personal-${createHash("sha256").update(userId).digest("hex").slice(0, 32)}`;
}

export function readBrowserTenantSelection(request: Request): string | null {
  const explicit = request.headers.get("x-tenant-id");
  if (explicit !== null) return explicit;
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${TENANT_SELECTION_COOKIE}=`));
  return cookie === undefined ? null : cookie.slice(TENANT_SELECTION_COOKIE.length + 1);
}

export async function resolveTenantMembership(userId: string, selectedTenantId?: string | null) {
  const where = { userId, status: "ACTIVE", tenant: { status: "ACTIVE" } } as const;
  const select = { tenantId: true, role: true, status: true } as const;
  if (selectedTenantId != null) {
    const tenantId = parseTenantIdHeader(selectedTenantId);
    if (!tenantId) return null;
    const membership = await prisma.tenantMembership.findFirst({ where: { ...where, tenantId }, select });
    return membership?.tenantId === tenantId ? membership : null;
  }
  const personal = await prisma.tenantMembership.findFirst({
    where: { ...where, tenantId: personalTenantId(userId) },
    select,
  });
  if (personal) return personal;
  const memberships = await prisma.tenantMembership.findMany({ where, select, take: 2 });
  return memberships.length === 1 ? memberships[0] : null;
}

export type TenantIdentity = {
  id: string;
  role: TenantActor["platformRole"];
  authMethod: "session" | "apiKey" | "oauth";
  credentialTenantId?: string | null;
  tenantScopes?: readonly string[];
  oauthScopes?: readonly string[];
};

export async function getRequestTenantContext(user: TenantIdentity, request: Request) {
  const browser = user.authMethod === "session";
  const credentialTenantId = browser ? null : user.credentialTenantId;
  const explicit = request.headers.get("x-tenant-id");
  if (!browser && (!credentialTenantId || (explicit !== null && parseTenantIdHeader(explicit) !== credentialTenantId))) {
    return null;
  }

  const membership = await resolveTenantMembership(
    user.id,
    browser ? readBrowserTenantSelection(request) : credentialTenantId,
  );
  if (!membership) return null;

  const actor: TenantActor & { tenantId: string } = {
    userId: user.id,
    platformRole: user.role,
    authMethod: user.authMethod,
    tenantId: membership.tenantId,
    tenantRole: membership.role,
    membershipStatus: membership.status,
  };
  return { actor, credentialTenantId, scopes: user.authMethod === "apiKey" ? user.tenantScopes : user.oauthScopes };
}

export function permitsOwnedTenantResource(
  context: NonNullable<Awaited<ReturnType<typeof getRequestTenantContext>>>,
  resource: { tenantId: string | null; ownerUserId: string },
  action: Exclude<TenantAction, "MANAGE_TENANT">,
): boolean {
  const read = action === "READ";
  if (!read && context.actor.tenantRole === "VIEWER") return false;
  const requiredScope = read
    ? context.actor.authMethod === "oauth" && context.scopes?.includes("sessions:read") ? "sessions:read" : "api:read"
    : "api:write";
  return decideTenantAccess({
    ...context,
    action,
    resource,
    requiredScopes: context.actor.authMethod === "session" ? undefined : [requiredScope],
  }).allowed;
}
