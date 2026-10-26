import test from "node:test";
import assert from "node:assert/strict";
import { hasRequiredOAuthScope, normalizeApiPathname, requiredOAuthScopes } from "../oauth/api-policy";
import { hasCompatibleScopeSet } from "../oauth/scopes";
import { familyAccessTokenWhere } from "../oauth/token-family";

const permits = (method: string, path: string, scopes: string[]) =>
  hasRequiredOAuthScope(scopes, requiredOAuthScopes(method, path));

test("sessions:read is limited to the session collection and a single session", () => {
  assert.equal(permits("GET", "/api/sessions", ["sessions:read"]), true);
  assert.equal(permits("GET", "/api/sessions/session-1", ["sessions:read"]), true);
  assert.equal(permits("GET", "/api/sessions/session-1", ["mcp:read"]), false);
  assert.equal(permits("GET", "/api/messages/session-1", ["sessions:read"]), false);
  assert.equal(permits("GET", "/api/system/monitor", ["sessions:read"]), false);
});

test("API and MCP scopes cannot authorize unlisted API surfaces or unsupported methods", () => {
  assert.equal(permits("GET", "/api/messages/session-1", ["mcp:read"]), false);
  assert.equal(permits("GET", "/api/messages/session-1", ["api:read"]), true);
  assert.equal(permits("POST", "/api/messages/session-1/send", ["mcp:write"]), false);
  assert.equal(permits("POST", "/api/messages/session-1/send", ["mcp:read", "mcp:write"]), false);
  assert.equal(permits("POST", "/api/messages/session-1/send", ["api:write"]), true);
  assert.equal(permits("GET", "/api/users", ["api:read"]), false);
  assert.equal(permits("OPTIONS", "/api/messages/session-1", ["api:read"]), false);
  assert.equal(permits("GET", "/api/unknown", ["api:read"]), false);
});

test("OAuth endpoint tokens are not accepted as generic API credentials", () => {
  assert.equal(permits("GET", "/api/oauth/grants", ["api:read"]), true);
  assert.equal(permits("POST", "/api/oauth/token", ["api:write"]), false);
  assert.equal(permits("GET", "/api/oauth/userinfo", ["api:read"]), false);
  assert.equal(permits("GET", "/api/sessions/session-1/qr", ["api:read"]), false);
});

test("OAuth MCP grants require the matching API scopes", () => {
  assert.equal(hasCompatibleScopeSet(["mcp:read"]), false);
  assert.equal(hasCompatibleScopeSet(["mcp:read", "api:read"]), true);
  assert.equal(hasCompatibleScopeSet(["mcp:read", "mcp:write", "api:read"]), false);
  assert.equal(hasCompatibleScopeSet(["mcp:read", "mcp:write", "api:read", "api:write"]), true);
  assert.equal(hasCompatibleScopeSet(["sessions:read"]), true);
});

test("OAuth API path normalization accepts only the configured base path or exact API root", () => {
  assert.equal(normalizeApiPathname("/wa-akg/api/messages/session-1", "/wa-akg"), "/api/messages/session-1");
  assert.equal(normalizeApiPathname("/api/messages/session-1", "/wa-akg"), "/api/messages/session-1");
  assert.equal(normalizeApiPathname("/untrusted/api/messages/session-1", "/wa-akg"), null);
});

test("access-token family revocation filters preserve separate grants", () => {
  const firstFamily = familyAccessTokenWhere({ familyId: "family-a", clientId: "client-1", userId: "user-1" });
  const otherFamily = familyAccessTokenWhere({ familyId: "family-b", clientId: "client-1", userId: "user-1" });
  assert.deepEqual(firstFamily, {
    revokedAt: null,
    OR: [
      { familyId: "family-a" },
      { familyId: null, clientId: "client-1", userId: "user-1" },
    ],
  });
  assert.notDeepEqual(firstFamily.OR[0], otherFamily.OR[0]);
  assert.deepEqual(otherFamily.OR[0], { familyId: "family-b" });
});
