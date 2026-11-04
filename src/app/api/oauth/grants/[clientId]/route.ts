import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { oauthJson, revokeClientGrants } from "@/lib/oauth";
import { readBrowserTenantSelection, resolveTenantMembership } from "@/lib/tenancy/context";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return oauthJson({ error: "unauthorized" }, 401);
  if (user.authMethod !== "session") return oauthJson({ error: "forbidden" }, 403);
  const requestedUserId = new URL(request.url).searchParams.get("userId");
  if (requestedUserId !== null && requestedUserId !== user.id) return oauthJson({ error: "forbidden" }, 403);
  const membership = await resolveTenantMembership(user.id, readBrowserTenantSelection(request));
  if (!membership) return oauthJson({ error: "forbidden" }, 403);
  const { clientId } = await params;
  await revokeClientGrants(user.id, membership.tenantId, clientId);
  return oauthJson({ status: true });
}
