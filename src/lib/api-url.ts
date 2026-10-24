/** Prefixes same-origin API URLs for reverse-proxy subpath deployments. */
export function apiUrl(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const normalizedPath = path.startsWith("/") ? path : "/" + path;
  if (!basePath || normalizedPath === basePath || normalizedPath.startsWith(basePath + "/")) return normalizedPath;
  return basePath + normalizedPath;
}
