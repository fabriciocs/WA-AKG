import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { errorJson, oauthJson, updateClient } from "@/lib/oauth";
import { readBrowserTenantSelection, resolveTenantMembership } from "@/lib/tenancy/context";

const updateSchema = z.object({
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
}).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (user?.authMethod !== "session") return oauthJson({ error: "forbidden" }, 403);
  const membership = await resolveTenantMembership(user.id, readBrowserTenantSelection(request));
  if (membership?.role !== "OWNER" && membership?.role !== "ADMIN") return oauthJson({ error: "forbidden" }, 403);
  try {
    const input = updateSchema.parse(await request.json());
    const { clientId } = await params;
    const client = await updateClient(clientId, membership.tenantId, input);
    return client ? oauthJson(client) : oauthJson({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) return oauthJson({ error: "invalid_request", details: error.flatten() }, 400);
    return errorJson(error);
  }
}
