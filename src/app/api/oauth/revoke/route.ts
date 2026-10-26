import { NextRequest } from "next/server";
import { clientCredentials, errorJson, formParameters, oauthJson } from "@/lib/oauth/http";
import { authenticateOAuthClient, revokeToken } from "@/lib/oauth";

export async function POST(request: NextRequest) {
  try {
    const params = await formParameters(request);
    const credentials = clientCredentials(request, params);
    await authenticateOAuthClient(credentials.clientId, credentials.clientSecret);
    await revokeToken(params.get("token") ?? "", credentials.clientId);
    return oauthJson({});
  } catch (error) {
    return errorJson(error);
  }
}
