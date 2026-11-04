export type HeaderReader = Pick<Headers, "get">;

export function normalizeBasePath(value: string | null | undefined): string {
  if (!value || value === "/") return "";
  const segments = value.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".." || !/^[A-Za-z0-9._~-]+$/.test(segment))) return "";
  return segments.length ? `/${segments.join("/")}` : "";
}

export function requestBasePath(headers: HeaderReader): string {
  return normalizeBasePath(headers.get("x-forwarded-prefix"));
}

export function requestPublicOrigin(headers: HeaderReader, fallbackUrl: string | URL): string {
  const fallback = new URL(fallbackUrl);
  const host = headers.get("x-forwarded-host")?.split(",", 1)[0].trim() || fallback.host;
  const forwardedProtocol = headers.get("x-forwarded-proto")?.split(",", 1)[0].trim().toLowerCase();
  const protocol = forwardedProtocol ? `${forwardedProtocol}:` : fallback.protocol;
  if (protocol !== "http:" && protocol !== "https:") return fallback.origin;

  try {
    const publicUrl = new URL(`${protocol}//${host}`);
    return publicUrl.username || publicUrl.password ? fallback.origin : publicUrl.origin;
  } catch {
    return fallback.origin;
  }
}

export function withBasePath(path: string, basePath: string): string {
  if (!basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  const match = path.match(/^([^?#]*)(.*)$/);
  const pathname = match?.[1] ?? path;
  const suffix = match?.[2] ?? "";
  if (pathname === basePath || pathname.startsWith(`${basePath}/`)) return path;
  return `${basePath}${pathname}${suffix}`;
}

export function safeCallbackPath(value: string | null | undefined, basePath: string, fallback = "/dashboard"): string {
  const safeFallback = withBasePath(fallback, basePath);
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) {
    return safeFallback;
  }
  try {
    const parsed = new URL(value, "https://app.invalid");
    if (parsed.origin !== "https://app.invalid") return safeFallback;
    return withBasePath(`${parsed.pathname}${parsed.search}${parsed.hash}`, basePath);
  } catch {
    return safeFallback;
  }
}

export function withoutBasePath(path: string, basePath: string): string {
  if (!basePath || (path !== basePath && !path.startsWith(`${basePath}/`))) return path;
  return path.slice(basePath.length) || "/";
}

export function clientBasePath(): string {
  if (typeof document === "undefined") return "";
  return normalizeBasePath(document.documentElement.dataset.basePath);
}
