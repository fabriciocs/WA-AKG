import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getClient, createAuthorizationRequest, OAuthError } from "@/lib/oauth";
import { isCimdClientId, resolveCimdClient } from "@/lib/oauth/cimd";
import { parseScopeString } from "@/lib/oauth/scopes";
import { appOrigin, mcpResourceUrl, oauthIssuer } from "@/lib/oauth/discovery.mjs";
import { prisma } from "@/lib/prisma";
import { requestBasePath, requestPublicOrigin, withBasePath } from "@/lib/base-path";
import { checkOAuthRateLimitDistributed, trustedProxyClientIp } from "@/lib/oauth/dcr-rate-limit";

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
    const rate = await checkOAuthRateLimitDistributed("authorize", trustedProxyClientIp(request), { limit: 60, windowMs: 5 * 60 * 1000 });
    if (!rate.allowed) throw new OAuthError("Too many authorization requests", "slow_down", 429);
    if (params.get("response_type") !== "code") throw new OAuthError("Only response_type=code is supported", "unsupported_response_type");
    const client = isCimdClientId(clientId) ? await resolveCimdClient(clientId) : await getClient(clientId);
    if (!client) throw new OAuthError("Unknown client_id", "invalid_client", 400);
    const challengeMethod = params.get("code_challenge_method");
    const challenge = params.get("code_challenge") ?? "";
    if (challengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new OAuthError("PKCE S256 is required", "invalid_request");
    const state = params.get("state") ?? "";
    const resource = params.get("resource") ?? undefined;
    const scope = parseScopeString(params.get("scope") ?? "");
    const basePath = requestBasePath(request.headers);
    const requestOrigin = requestPublicOrigin(request.headers, request.url);
    if (resource) {
      const issuer = oauthIssuer({
        configuredIssuer: process.env.OAUTH_ISSUER_URL,
        configuredOrigin: process.env.BASE_URL,
        requestOrigin,
        basePath,
      });
      if (new URL(resource).origin !== new URL(issuer).origin) throw new OAuthError("resource must belong to this OAuth issuer", "invalid_target");
    }
    if (scope.some((item) => item.startsWith("mcp:"))) {
      const expectedResource = mcpResourceUrl({
        origin: appOrigin({ configuredOrigin: process.env.BASE_URL, requestOrigin }),
        basePath,
        endpointPath: process.env.WA_AKG_MCP_HTTP_PATH || "/mcp",
      });
      if (resource !== expectedResource) throw new OAuthError("resource must exactly match the configured MCP endpoint", "invalid_target");
    }
    const requestId = await createAuthorizationRequest({
      client,
      redirectUri,
      scope,
      state,
      codeChallenge: challenge,
      resource,
    });
    const session = await auth();
    if (session?.user?.id) {
      const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { emailVerified: true } });
      if (!user?.emailVerified) return NextResponse.json({ error: "email_not_verified" }, { status: 403, headers: noStore });
    }
    const pathWithBase = withBasePath(request.nextUrl.pathname, basePath);
    if (!session?.user?.id) {
      const login = new URL(withBasePath("/auth/login", basePath), requestPublicOrigin(request.headers, request.url));
      login.searchParams.set("callbackUrl", `${pathWithBase}${request.nextUrl.search}`);
      return NextResponse.redirect(login, { headers: noStore });
    }
    const consent = new URL(withBasePath("/auth/oauth/consent", basePath), requestPublicOrigin(request.headers, request.url));
    consent.searchParams.set("requestId", requestId);
    return NextResponse.redirect(consent, { headers: noStore });
  } catch (error) {
    return oauthError(error);
  }
}
