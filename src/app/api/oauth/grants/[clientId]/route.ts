import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { oauthJson, revokeClientGrants } from "@/lib/oauth";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return oauthJson({ error: "unauthorized" }, 401);
  if (user.role !== "SUPERADMIN") return oauthJson({ error: "forbidden" }, 403);
  const { clientId } = await params;
  await revokeClientGrants(user.id, clientId);
  return oauthJson({ status: true });
}
