import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { createClient, OAuthError, OAuthGrantType, OAuthScope, oauthJson, errorJson } from "@/lib/oauth";
import { prisma } from "@/lib/prisma";
import { isSafeDcrRedirectUri } from "@/lib/oauth/dcr-registration";
import { hasCompatibleScopeSet } from "@/lib/oauth/scopes";
import { readBrowserTenantSelection, resolveTenantMembership } from "@/lib/tenancy/context";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  redirectUris: z.array(z.string().url().refine(isSafeDcrRedirectUri, "Use HTTPS or loopback HTTP without fragments or credentials")).max(20).default([]),
  allowedScopes: z.array(z.enum(Object.values(OAuthScope) as [string, ...string[]])).min(1),
  grantTypes: z.array(z.enum(["authorization_code", "refresh_token"])).min(1),
  isConfidential: z.boolean().default(true),
});

async function admin(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (user?.authMethod !== "session") return null;
  const membership = await resolveTenantMembership(user.id, readBrowserTenantSelection(request));
  if (membership?.role !== "OWNER" && membership?.role !== "ADMIN") return null;
  return { userId: user.id, tenantId: membership.tenantId };
}

export async function GET(request: NextRequest) {
  const owner = await admin(request);
  if (!owner) return oauthJson({ error: "forbidden" }, 403);
  const clients = await prisma.oAuthClient.findMany({
    where: { tenantId: owner.tenantId },
    select: { id: true, clientId: true, name: true, description: true, redirectUris: true, allowedScopes: true, grantTypes: true, isConfidential: true, isActive: true, lastUsedAt: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return oauthJson(clients);
}

export async function POST(request: NextRequest) {
  const owner = await admin(request);
  if (!owner) return oauthJson({ error: "forbidden" }, 403);
  try {
    const input = schema.parse(await request.json());
    if (input.grantTypes.includes("authorization_code") && !input.redirectUris.length) throw new OAuthError("Authorization code clients need at least one redirect URI");
    if (new Set(input.redirectUris).size !== input.redirectUris.length || !hasCompatibleScopeSet(input.allowedScopes) || new Set(input.allowedScopes).size !== input.allowedScopes.length) throw new OAuthError("Invalid redirect URI or incompatible scopes");
    const result = await createClient({
      ...input, grantTypes: input.grantTypes as OAuthGrantType[], createdById: owner.userId, tenantId: owner.tenantId,
    });
    return oauthJson(result, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return oauthJson({ error: "invalid_request", details: error.flatten() }, 400);
    return errorJson(error);
  }
}
