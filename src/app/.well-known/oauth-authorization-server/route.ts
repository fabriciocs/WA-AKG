import { NextRequest } from "next/server";
import { oauthJson } from "@/lib/oauth/http";
import { normalizeBasePath, oauthIssuer } from "@/lib/oauth/discovery.mjs";

export function GET(request: NextRequest) {
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH || request.nextUrl.basePath || "");
  const issuer = oauthIssuer({
    configuredIssuer: process.env.OAUTH_ISSUER_URL,
    configuredOrigin: process.env.BASE_URL,
    requestOrigin: request.nextUrl.origin,
    basePath,
  });
  return oauthJson({
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    introspection_endpoint: `${issuer}/api/oauth/introspect`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    authorization_response_iss_parameter_supported: true,
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
    scopes_supported: ["api:read", "api:write", "mcp:read", "mcp:write", "sessions:read"],
  });
}
