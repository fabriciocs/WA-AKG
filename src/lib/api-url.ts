/** Prefixes same-origin API URLs for reverse-proxy subpath deployments. */
import { clientBasePath, withBasePath } from "@/lib/base-path";

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return withBasePath(normalizedPath, clientBasePath());
}
