import { OAuthScope } from "./types";

const READ_ROOTS = new Set([
  "sessions", "messages", "contacts", "groups", "webhooks", "autoreplies",
  "scheduler", "chat", "chats", "profile", "labels", "status", "notifications",
  "media", "system",
]);
const WRITE_ROOTS = new Set([
  "sessions", "messages", "contacts", "groups", "webhooks", "autoreplies",
  "scheduler", "chat", "chats", "profile", "labels", "notifications",
]);

/**
 * Map an API method and normalized pathname to its OAuth scopes. Unknown routes,
 * methods, authentication surfaces and administrative APIs are denied by default.
 */
export function requiredOAuthScopes(method: string, pathname: string): string[] | null {
  const verb = method.toUpperCase();
  if (!pathname.startsWith("/api/")) return null;

  // Token management and identity endpoints have their own client/user auth.
  if (/^\/api\/(?:auth|oauth)(?:\/|$)/.test(pathname)) {
    if (verb === "GET" && pathname === "/api/oauth/grants") return [OAuthScope.API_READ];
    return null;
  }
  if (/^\/api\/(?:swagger-auth|user\/api-key|users|settings\/system)(?:\/|$)/.test(pathname)) return null;
  // Pairing QR values are bearer-like secrets and are never exposed to OAuth tokens.
  if (/^\/api\/sessions\/[^/]+\/qr(?:\/|$)/.test(pathname)) return null;

  const relative = pathname.slice("/api/".length);
  const root = relative.split("/")[0];
  if (verb === "GET") {
    if (!READ_ROOTS.has(root)) return null;
    // This narrow scope grants only listing or reading a single session record.
    if (/^\/api\/sessions(?:\/[^/]+)?$/.test(pathname)) {
      return [OAuthScope.API_READ, OAuthScope.SESSIONS_READ];
    }
    return [OAuthScope.API_READ];
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(verb) && WRITE_ROOTS.has(root)) {
    // MCP write is a tool capability, never a direct HTTP API write permission.
    return [OAuthScope.API_WRITE];
  }
  return null;
}

export function normalizeApiPathname(rawPathname: string, configuredBasePath: string): string | null {
  const normalizedBasePath = configuredBasePath.replace(/^\/+|\/+$/g, "");
  const basePath = normalizedBasePath ? `/${normalizedBasePath}` : "";
  if (basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`))) {
    return rawPathname.slice(basePath.length) || "/";
  }
  return rawPathname === "/api" || rawPathname.startsWith("/api/") ? rawPathname : null;
}

export function hasRequiredOAuthScope(granted: string[], required: string[] | null): boolean {
  return Boolean(required?.some((scope) => granted.includes(scope)));
}
