import { NextRequest } from "next/server";
import { bearerFrom, oauthJson } from "@/lib/oauth/http";
import { authenticateAccessToken, hasAnyScope, OAuthScope } from "@/lib/oauth";

export async function GET(request: NextRequest) {
  const token = bearerFrom(request);
  const principal = token ? await authenticateAccessToken(token) : null;
  if (!principal || !principal.userId) {
    return oauthJson({ error: "invalid_token" }, 401);
  }
  if (!hasAnyScope(principal.scope, [OAuthScope.MCP_READ, OAuthScope.API_READ, OAuthScope.SESSIONS_READ])) {
    return oauthJson({ error: "insufficient_scope" }, 403);
  }
  return oauthJson({
    sub: principal.userId,
    wa_akg: { client_id: principal.clientId, scope: principal.scope, session_scope: principal.sessionScope },
  });
}
