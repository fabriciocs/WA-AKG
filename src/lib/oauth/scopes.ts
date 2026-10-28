import { OAuthScope } from "./types";
import { DEFAULT_BRAND_NAME } from "@/lib/branding";
import { getBrandConfig } from "@/lib/branding-server";

export function getScopeDescriptions(brandName = DEFAULT_BRAND_NAME): Record<string, string> {
  const name = brandName.trim() || DEFAULT_BRAND_NAME;
  return {
    [OAuthScope.API_READ]: "Read " + name + " API resources",
    [OAuthScope.API_WRITE]: "Create and update " + name + " API resources",
    [OAuthScope.MCP_READ]: "Use read-only MCP tools",
    [OAuthScope.MCP_WRITE]: "Use enabled write MCP tools",
    [OAuthScope.SESSIONS_READ]: "Read authorized WhatsApp sessions",
  };
}

export const SCOPE_DESCRIPTIONS: Record<string, string> = getScopeDescriptions();

export async function getRuntimeScopeDescriptions(): Promise<Record<string, string>> {
  const brand = await getBrandConfig();
  return getScopeDescriptions(brand.name);
}

export function parseScopeString(scope: string): string[] {
  return [...new Set(scope.trim().split(/\s+/).filter(Boolean))];
}

export function formatScope(scopes: string[]): string {
  return [...new Set(scopes)].join(" ");
}

export function isValidScope(scope: string): boolean {
  return Object.values(OAuthScope).includes(scope as (typeof OAuthScope)[keyof typeof OAuthScope]);
}

export function filterAllowedScopes(requested: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return [...new Set(requested)].filter((scope) => allowedSet.has(scope));
}

export function hasAnyScope(granted: string[], accepted: string[]): boolean {
  return accepted.some((scope) => granted.includes(scope));
}

export function hasCompatibleScopeSet(scopes: string[]): boolean {
  if (scopes.includes(OAuthScope.MCP_READ) && !scopes.includes(OAuthScope.API_READ)) return false;
  if (scopes.includes(OAuthScope.MCP_WRITE) && (!scopes.includes(OAuthScope.MCP_READ) || !scopes.includes(OAuthScope.API_WRITE))) return false;
  return true;
}
