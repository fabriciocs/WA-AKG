import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { listUserGrants, oauthJson } from "@/lib/oauth";
import { readBrowserTenantSelection, resolveTenantMembership } from "@/lib/tenancy/context";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) return oauthJson({ error: "unauthorized" }, 401);
  // Listing another user's OAuth grants requires a separately audited
  // privileged admin flow, never a platform role on an ordinary credential.
  if (user.authMethod !== "session") return oauthJson({ error: "forbidden" }, 403);
  const membership = await resolveTenantMembership(user.id, readBrowserTenantSelection(request));
  if (!membership) return oauthJson({ error: "forbidden" }, 403);
  return oauthJson(await listUserGrants(user.id, membership.tenantId));
}
