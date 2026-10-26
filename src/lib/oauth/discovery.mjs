const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeBasePath(value = "") {
  const path = String(value).trim();
  if (!path || path === "/") return "";
  if (/[?#\\]/.test(path)) throw new Error("Invalid app base path");
  const normalized = `/${path.split("/").filter(Boolean).join("/")}`;
  return normalized === "/" ? "" : normalized;
}

export function normalizeEndpointPath(value = "/mcp") {
  const path = String(value).trim();
  if (!path || /[?#\\]/.test(path)) throw new Error("Invalid MCP endpoint path");
  const normalized = `/${path.split("/").filter(Boolean).join("/")}`;
  return normalized === "/" ? "/mcp" : normalized;
}

export function withBasePath(basePath, routePath) {
  const base = normalizeBasePath(basePath);
  const route = normalizeEndpointPath(routePath);
  if (!base || route === base || route.startsWith(`${base}/`)) return route;
  return `${base}${route}`;
}

export function appOrigin({ configuredOrigin, requestOrigin }) {
  const candidate = configuredOrigin?.trim() || requestOrigin;
  if (!candidate) throw new Error("WA-AKG public origin is unavailable");
  const url = new URL(candidate);
  if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password) {
    throw new Error("Invalid WA-AKG public origin");
  }
  return url.origin;
}

export function requestOriginFromNodeRequest(req) {
  const rawHost = req.headers.host;
  if (typeof rawHost !== "string" || !rawHost || /[\s/@?#\\,%;]/.test(rawHost)) {
    return "http://localhost";
  }
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",", 1)[0].trim().toLowerCase();
  const protocol = HTTP_PROTOCOLS.has(`${forwardedProto}:`) ? forwardedProto : "http";
  try {
    return appOrigin({ requestOrigin: `${protocol}://${rawHost}` });
  } catch {
    return "http://localhost";
  }
}

export function oauthIssuer({ configuredIssuer, configuredOrigin, requestOrigin, basePath }) {
  const explicitIssuer = configuredIssuer?.trim();
  if (explicitIssuer) {
    const issuer = new URL(explicitIssuer);
    if (!HTTP_PROTOCOLS.has(issuer.protocol) || issuer.username || issuer.password || issuer.search || issuer.hash) {
      throw new Error("Invalid OAuth issuer URL");
    }
    return explicitIssuer.replace(/\/+$/, "");
  }

  const origin = appOrigin({ configuredOrigin, requestOrigin });
  return `${origin}${normalizeBasePath(basePath)}`;
}

export function protectedResourceMetadataUrl({ origin, basePath }) {
  return new URL(withBasePath(basePath, "/.well-known/oauth-protected-resource"), origin).toString();
}

export function authorizationRedirectWithIssuer(redirectUri, issuer) {
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("iss", issuer);
  return redirect;
}

export function mcpResourceUrl({ origin, basePath, endpointPath }) {
  return new URL(withBasePath(basePath, endpointPath), origin).toString();
}

export function protectedResourceMetadata({ configuredOrigin, requestOrigin, configuredIssuer, basePath, endpointPath }) {
  const origin = appOrigin({ configuredOrigin, requestOrigin });
  const issuer = oauthIssuer({ configuredIssuer, configuredOrigin: origin, basePath });
  return {
    resource: mcpResourceUrl({ origin, basePath, endpointPath }),
    authorization_servers: [issuer],
  };
}
