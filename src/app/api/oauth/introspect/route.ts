import { NextRequest } from "next/server";
import { clientCredentials, errorJson, formParameters, oauthJson } from "@/lib/oauth/http";
import { introspectToken } from "@/lib/oauth";

export async function POST(request: NextRequest) {
  try {
    const params = await formParameters(request);
    const credentials = clientCredentials(request, params);
    return oauthJson(await introspectToken(params.get("token") ?? "", credentials.clientId, credentials.clientSecret));
  } catch (error) {
    return errorJson(error);
  }
}
