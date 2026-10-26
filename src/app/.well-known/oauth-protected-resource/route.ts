import { NextRequest } from "next/server";
import { oauthJson } from "@/lib/oauth/http";
import { normalizeBasePath, protectedResourceMetadata } from "@/lib/oauth/discovery.mjs";

export function GET(request: NextRequest) {
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH || request.nextUrl.basePath || "");
  const metadata = protectedResourceMetadata({
    configuredOrigin: process.env.BASE_URL,
    basePath,
    endpointPath: process.env.WA_AKG_MCP_HTTP_PATH || "/mcp",
    configuredIssuer: process.env.OAUTH_ISSUER_URL,
    requestOrigin: request.nextUrl.origin,
  });
  return oauthJson({
    ...metadata,
    bearer_methods_supported: ["header"],
    // MCP calls the WA-AKG API with the delegated token, so MCP scopes must be
    // paired with the corresponding API capability scopes during authorization.
    scopes_supported: ["api:read", "api:write", "mcp:read", "mcp:write", "sessions:read"],
  });
}
