/** Pure, fail-closed checks used by the first-run WhatsApp/MCP wizard. */
export function isLiveWhatsAppSession(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as { status?: unknown; hasInstance?: unknown; isLiveConnected?: unknown };
  // A persisted DB status may be stale. Only the live Baileys instance can confirm readiness.
  return data.status === "CONNECTED" && data.hasInstance === true && data.isLiveConnected === true;
}

type AuthorizationMetadata = {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  code_challenge_methods_supported?: unknown;
  authorization_servers?: unknown;
};

type ResourceMetadata = { resource?: unknown; authorization_servers?: unknown };

export type McpDiscoveryResult =
  | { ok: true; issuer: string; resource: string }
  | { ok: false; reason: string };

export function validateMcpDiscovery(
  authorization: unknown,
  resource: unknown,
  expectedOrigin: string,
): McpDiscoveryResult {
  if (!authorization || typeof authorization !== "object" ||
      !resource || typeof resource !== "object") {
    return { ok: false, reason: "OAuth discovery returned an invalid document." };
  }
  const auth = authorization as AuthorizationMetadata;
  const protectedResource = resource as ResourceMetadata;
  if (typeof auth.issuer !== "string" || typeof protectedResource.resource !== "string") {
    return { ok: false, reason: "OAuth issuer or MCP resource is missing." };
  }
  try {
    const issuer = new URL(auth.issuer);
    const mcp = new URL(protectedResource.resource);
    const origin = new URL(expectedOrigin);
    const currentIsLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname.toLowerCase());
    const issuerIsLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(issuer.hostname.toLowerCase());
    if (issuer.origin !== mcp.origin || (issuer.origin !== origin.origin && !currentIsLoopback)) {
      return { ok: false, reason: "OAuth issuer and MCP resource must share the canonical public origin." };
    }
    // Local dashboards may legitimately advertise an HTTPS public issuer via Caddy/ngrok.
    if (issuer.protocol !== "https:" && !(issuer.protocol === "http:" && issuerIsLoopback)) {
      return { ok: false, reason: "OAuth issuer must use HTTPS except on loopback." };
    }
    if (!Array.isArray(protectedResource.authorization_servers) ||
        !protectedResource.authorization_servers.includes(issuer.href.replace(/\/$/, ""))) {
      return { ok: false, reason: "MCP resource metadata does not advertise this OAuth issuer." };
    }
    if (!Array.isArray(auth.code_challenge_methods_supported) ||
        !auth.code_challenge_methods_supported.includes("S256")) {
      return { ok: false, reason: "OAuth authorization server does not advertise PKCE S256." };
    }
    for (const field of ["authorization_endpoint", "token_endpoint"] as const) {
      const value = auth[field];
      if (typeof value !== "string" || !value.startsWith(issuer.href.replace(/\/$/, "") + "/")) {
        return { ok: false, reason: "OAuth discovery has an inconsistent " + field + "." };
      }
    }
    return { ok: true, issuer: issuer.href.replace(/\/$/, ""), resource: mcp.href };
  } catch {
    return { ok: false, reason: "OAuth/MCP discovery contains invalid URLs." };
  }
}
