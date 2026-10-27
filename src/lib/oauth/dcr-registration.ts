import { z } from "zod";
import { createClient } from "./service";
import { checkDcrRegistrationRateLimit, trustedProxyClientIp, type DcrRateLimitResult } from "./dcr-rate-limit";
import { formatScope, hasCompatibleScopeSet } from "./scopes";
import { OAuthError, OAuthScope } from "./types";
import { oauthJson } from "./http";

const MAX_REGISTRATION_BODY_BYTES = 16 * 1024;
const MAX_REDIRECT_URIS = 20;
const MAX_REDIRECT_URI_LENGTH = 2048;
const DEFAULT_SCOPES = [OAuthScope.MCP_READ, OAuthScope.API_READ, OAuthScope.SESSIONS_READ];
const SUPPORTED_SCOPES = Object.values(OAuthScope);
const SUPPORTED_GRANTS = ["authorization_code", "refresh_token"] as const;

const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(80).optional(),
  redirect_uris: z.array(z.string().min(1).max(MAX_REDIRECT_URI_LENGTH)).min(1).max(MAX_REDIRECT_URIS),
  grant_types: z.array(z.string().min(1).max(64)).max(SUPPORTED_GRANTS.length).optional(),
  response_types: z.array(z.string().min(1).max(64)).max(1).optional(),
  token_endpoint_auth_method: z.string().min(1).max(64).optional(),
  scope: z.string().max(512).optional(),
});

type RegistrationInput = z.infer<typeof registrationSchema>;
type CreateClient = typeof createClient;

export function isSafeDcrRedirectUri(value: string): boolean {
  if (!value || value.length > MAX_REDIRECT_URI_LENGTH || value.includes("#")) return false;
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0];
    if (authority.includes("@") || url.username || url.password || !url.hostname) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function invalidMetadata(message: string) {
  return new OAuthError(message, "invalid_client_metadata", 400);
}

function validatedMetadata(input: unknown) {
  const result = registrationSchema.safeParse(input);
  if (!result.success) throw invalidMetadata("Invalid OAuth client metadata");
  const metadata: RegistrationInput = result.data;
  const redirects = metadata.redirect_uris;
  if (new Set(redirects).size !== redirects.length || redirects.some((uri) => !isSafeDcrRedirectUri(uri))) {
    throw invalidMetadata("redirect_uris must contain unique HTTPS or loopback HTTP URLs without fragments or credentials");
  }

  const grantTypes = metadata.grant_types ?? [...SUPPORTED_GRANTS];
  if (
    new Set(grantTypes).size !== grantTypes.length ||
    !grantTypes.includes("authorization_code") ||
    grantTypes.some((grant) => !SUPPORTED_GRANTS.includes(grant as (typeof SUPPORTED_GRANTS)[number]))
  ) {
    throw invalidMetadata("Only authorization_code and refresh_token grants are supported");
  }
  if (metadata.response_types && (metadata.response_types.length !== 1 || metadata.response_types[0] !== "code")) {
    throw invalidMetadata("Only the code response type is supported");
  }
  if (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== "none") {
    throw invalidMetadata("Only public clients using token_endpoint_auth_method=none are supported");
  }

  const requestedScopes = metadata.scope === undefined
    ? DEFAULT_SCOPES
    : metadata.scope.trim().split(/\s+/).filter(Boolean);
  if (
    !requestedScopes.length ||
    new Set(requestedScopes).size !== requestedScopes.length ||
    requestedScopes.some((scope) => !SUPPORTED_SCOPES.includes(scope as (typeof SUPPORTED_SCOPES)[number])) ||
    !hasCompatibleScopeSet(requestedScopes)
  ) {
    throw invalidMetadata("Only compatible WA-AKG API and MCP scopes are supported");
  }

  return {
    name: metadata.client_name ?? "WA-AKG MCP client",
    redirectUris: redirects,
    grantTypes: grantTypes as (typeof SUPPORTED_GRANTS)[number][],
    allowedScopes: requestedScopes,
  };
}

async function readBoundedBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REGISTRATION_BODY_BYTES) {
        await reader.cancel();
        throw invalidMetadata("OAuth client metadata is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export function createDcrRegistrationHandler(dependencies: {
  persistClient?: CreateClient;
  checkRateLimit?: (ip: string, now?: number) => DcrRateLimitResult;
  getClientIp?: (request: Request) => string;
  now?: () => number;
} = {}) {
  const persistClient = dependencies.persistClient ?? createClient;
  const checkRateLimit = dependencies.checkRateLimit ?? checkDcrRegistrationRateLimit;
  const getClientIp = dependencies.getClientIp ?? trustedProxyClientIp;
  const now = dependencies.now ?? Date.now;

  return async function registerOAuthClient(request: Request) {
    const rate = checkRateLimit(getClientIp(request), now());
    if (!rate.allowed) {
      const response = oauthJson(
        { error: "rate_limited", error_description: "Too many OAuth client registrations" },
        429,
      );
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return oauthJson({ error: "invalid_client_metadata", error_description: "Content-Type must be application/json" }, 400);
    }
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REGISTRATION_BODY_BYTES) {
      return oauthJson({ error: "invalid_client_metadata", error_description: "OAuth client metadata is too large" }, 413);
    }

    let rawBody: string;
    try {
      rawBody = await readBoundedBody(request);
    } catch (error) {
      if (error instanceof OAuthError) {
        return oauthJson({ error: error.code, error_description: error.message }, 413);
      }
      return oauthJson({ error: "invalid_client_metadata", error_description: "Invalid OAuth client metadata" }, 400);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return oauthJson({ error: "invalid_client_metadata", error_description: "Invalid JSON metadata" }, 400);
    }

    try {
      const metadata = validatedMetadata(body);
      const { client } = await persistClient({
        name: metadata.name,
        description: "Dynamically registered public MCP client",
        redirectUris: metadata.redirectUris,
        allowedScopes: metadata.allowedScopes,
        grantTypes: metadata.grantTypes,
        isConfidential: false,
        createdById: null,
      });
      const issuedAt = Math.floor(now() / 1000);
      return oauthJson({
        client_id: client.clientId,
        client_id_issued_at: issuedAt,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: formatScope(metadata.allowedScopes),
      }, 201);
    } catch (error) {
      if (error instanceof OAuthError) {
        return oauthJson({ error: error.code, error_description: error.message }, error.status);
      }
      return oauthJson({ error: "server_error", error_description: "OAuth client registration failed" }, 500);
    }
  };
}
