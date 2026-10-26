import { OAuthScope } from "./types";

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [OAuthScope.API_READ]: "Read WA-AKG API resources",
  [OAuthScope.API_WRITE]: "Create and update WA-AKG API resources",
  [OAuthScope.MCP_READ]: "Use read-only MCP tools",
  [OAuthScope.MCP_WRITE]: "Use enabled write MCP tools",
  [OAuthScope.SESSIONS_READ]: "Read authorized WhatsApp sessions",
};

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
