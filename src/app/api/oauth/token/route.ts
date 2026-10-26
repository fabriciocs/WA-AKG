import { NextRequest } from "next/server";
import { clientCredentials, errorJson, formParameters, oauthJson } from "@/lib/oauth/http";
import { exchangeAuthorizationCode, getClient, OAuthError, rotateRefreshToken } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const params = await formParameters(request);
    const grantType = params.get("grant_type");
    if (!grantType) throw new OAuthError("grant_type is required");
    if (grantType === "client_credentials") throw new OAuthError("The client_credentials grant is not supported", "unsupported_grant_type");
    const credentials = clientCredentials(request, params);
    const client = await getClient(credentials.clientId);
    if (!client) throw new OAuthError("Client authentication failed", "invalid_client", 401);
    let tokens;
    if (grantType === "authorization_code") {
      tokens = await exchangeAuthorizationCode({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        code: params.get("code") ?? "",
        redirectUri: params.get("redirect_uri") ?? "",
        codeVerifier: params.get("code_verifier") ?? "",
      });
    } else if (grantType === "refresh_token") {
      tokens = await rotateRefreshToken({ clientId: credentials.clientId, clientSecret: credentials.clientSecret, token: params.get("refresh_token") ?? "" });
    } else {
      throw new OAuthError("Unsupported grant_type", "unsupported_grant_type");
    }
    return oauthJson({ access_token: tokens.accessToken, token_type: tokens.tokenType, expires_in: tokens.expiresIn, scope: tokens.scope, ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}) });
  } catch (error) {
    return errorJson(error);
  }
}
