import { NextResponse } from "next/server";
import { OAuthError } from "./types";

export const noStoreHeaders = { "Cache-Control": "no-store", Pragma: "no-cache" };

export function oauthJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: noStoreHeaders });
}

export function errorJson(error: unknown) {
  const oauthError = error instanceof OAuthError ? error : new OAuthError("The OAuth request could not be completed", "server_error", 500);
  return oauthJson({ error: oauthError.code, error_description: oauthError.message }, oauthError.status);
}

export function clientCredentials(request: Request, params: URLSearchParams) {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
    if (!match) throw new OAuthError("Client authentication must use HTTP Basic", "invalid_client", 401);
    let decoded: string;
    try { decoded = Buffer.from(match[1], "base64").toString("utf8"); }
    catch { throw new OAuthError("Malformed client authentication", "invalid_client", 401); }
    const separator = decoded.indexOf(":");
    if (separator < 1) throw new OAuthError("Malformed client authentication", "invalid_client", 401);
    return { clientId: decodeURIComponent(decoded.slice(0, separator)), clientSecret: decodeURIComponent(decoded.slice(separator + 1)) };
  }
  return { clientId: params.get("client_id") ?? "", clientSecret: params.get("client_secret") ?? undefined };
}

export async function formParameters(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") throw new OAuthError("Content-Type must be application/x-www-form-urlencoded", "invalid_request", 400);
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > 16 * 1024) throw new OAuthError("OAuth request body is too large", "invalid_request", 413);
  return new URLSearchParams(body);
}

export function bearerFrom(request: Request) {
  return /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}
