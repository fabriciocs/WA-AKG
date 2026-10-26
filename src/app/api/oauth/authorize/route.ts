import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getClient, createAuthorizationRequest, OAuthError } from "@/lib/oauth";
import { parseScopeString } from "@/lib/oauth/scopes";
import { normalizeBasePath, oauthIssuer } from "@/lib/oauth/discovery.mjs";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };
export const dynamic = "force-dynamic";

function oauthError(error: unknown) {
  const value = error instanceof OAuthError ? error : new OAuthError("Invalid authorization request");
  return NextResponse.json({ error: value.code, error_description: value.message }, { status: value.status, headers: noStore });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const redirectUri = params.get("redirect_uri") ?? "";
  const clientId = params.get("client_id") ?? "";
  try {
    const client = await getClient(clientId);
    if (!client) throw new OAuthError("Unknown client_id", "invalid_client", 400);
    if (params.get("response_type") !== "code") throw new OAuthError("Only response_type=code is supported", "unsupported_response_type");
    const challengeMethod = params.get("code_challenge_method");
    const challenge = params.get("code_challenge") ?? "";
    if (challengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new OAuthError("PKCE S256 is required", "invalid_request");
    const state = params.get("state") ?? "";
    const resource = params.get("resource") ?? undefined;
    if (resource) {
      const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH || request.nextUrl.basePath || "");
      const issuer = oauthIssuer({
        configuredIssuer: process.env.OAUTH_ISSUER_URL,
        configuredOrigin: process.env.BASE_URL,
        requestOrigin: request.nextUrl.origin,
        basePath,
      });
      if (new URL(resource).origin !== new URL(issuer).origin) throw new OAuthError("resource must belong to this WA-AKG issuer", "invalid_target");
    }
    const requestId = await createAuthorizationRequest({
      client,
      redirectUri,
      scope: parseScopeString(params.get("scope") ?? ""),
      state,
      codeChallenge: challenge,
      resource,
    });
    const session = await auth();
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
    const pathWithBase = request.nextUrl.pathname.startsWith(basePath) ? request.nextUrl.pathname : `${basePath}${request.nextUrl.pathname}`;
    if (!session?.user?.id) {
      const login = new URL(`${basePath}/auth/login`, request.url);
      login.searchParams.set("callbackUrl", `${pathWithBase}${request.nextUrl.search}`);
      return NextResponse.redirect(login, { headers: noStore });
    }
    const consent = new URL(`${basePath}/auth/oauth/consent`, request.url);
    consent.searchParams.set("requestId", requestId);
    return NextResponse.redirect(consent, { headers: noStore });
  } catch (error) {
    return oauthError(error);
  }
}
