import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { createClient, OAuthError, OAuthGrantType, OAuthScope, oauthJson, errorJson } from "@/lib/oauth";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  redirectUris: z.array(z.string().url()).max(20).default([]),
  allowedScopes: z.array(z.enum(Object.values(OAuthScope) as [string, ...string[]])).min(1),
  grantTypes: z.array(z.enum(["authorization_code", "refresh_token"])).min(1),
  isConfidential: z.boolean().default(true),
});

async function admin(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  return user?.role === "SUPERADMIN" ? user : null;
}

export async function GET(request: NextRequest) {
  if (!await admin(request)) return oauthJson({ error: "forbidden" }, 403);
  const clients = await prisma.oAuthClient.findMany({
    select: { id: true, clientId: true, name: true, description: true, redirectUris: true, allowedScopes: true, grantTypes: true, isConfidential: true, isActive: true, lastUsedAt: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return oauthJson(clients);
}

export async function POST(request: NextRequest) {
  const user = await admin(request);
  if (!user) return oauthJson({ error: "forbidden" }, 403);
  try {
    const input = schema.parse(await request.json());
    if (input.grantTypes.includes("authorization_code") && !input.redirectUris.length) throw new OAuthError("Authorization code clients need at least one redirect URI");
    const result = await createClient({ ...input, grantTypes: input.grantTypes as OAuthGrantType[], createdById: user.id });
    return oauthJson(result, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return oauthJson({ error: "invalid_request", details: error.flatten() }, 400);
    return errorJson(error);
  }
}
