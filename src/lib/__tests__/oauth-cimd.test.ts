import test from "node:test";
import assert from "node:assert/strict";
import {
  createCimdClientResolver, isCimdClientId, isPublicCimdAddress,
  validateCimdDocument, validateCimdUrl,
} from "@/lib/oauth/cimd";
import type { OAuthClientRecord } from "@/lib/oauth/types";

const clientId = "https://client.example.org/oauth/client.json";
const redirectUri = "https://client.example.org/oauth/callback";
const extraRedirect = "https://client.example.org/oauth/other";
const readScopes = ["mcp:read", "api:read", "sessions:read"];
const writeScopes = [...readScopes, "mcp:write", "api:write"];
const metadata = {
  client_id: clientId,
  client_name: "Published identity",
  redirect_uris: [redirectUri],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
};

const existingClient: OAuthClientRecord = {
  id: "db-record",
  clientId, name: "Published identity", description: "CIMD",
  redirectUris: [redirectUri], allowedScopes: writeScopes,
  grantTypes: ["authorization_code", "refresh_token"], isConfidential: false, isActive: true,
};

test("CIMD is distinct from generated manual/DCR client IDs and enforces safe HTTPS URLs", () => {
  assert.equal(isCimdClientId(clientId), true);
  assert.equal(isCimdClientId("public-dcr-client-id"), false);
  assert.equal(validateCimdUrl(clientId).href, clientId);
  for (const invalid of [
    "http://client.example.org/metadata", "https://localhost/client.json",
    "https://127.0.0.1/client.json", "https://user:pass@client.example.org/metadata",
    "https://client.example.org/", "https://client.example.org/client.json?secret=1",
    "https://client.example.org/client.json#frag", "https://client.example.org:8443/client.json",
    "https://client.example.org/%2e%2e/admin", "https://client.example.org/oauth/../admin",
  ]) assert.throws(() => validateCimdUrl(invalid), { code: "invalid_client" }, invalid);
});

test("CIMD rejects non-public address families and special-use DNS results", () => {
  for (const blocked of [
    "127.0.0.1", "10.3.2.1", "172.16.0.1", "192.168.1.1",
    "169.254.169.254", "100.100.100.200", "192.0.2.1",
    "198.18.1.1", "198.51.100.4", "203.0.113.1", "224.0.0.1",
    "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1",
    "2001:db8::1", "2002::1", "2001::1", "3fff::5",
  ]) assert.equal(isPublicCimdAddress(blocked), false, blocked);
  assert.equal(isPublicCimdAddress("8.8.8.8"), true);
  assert.equal(isPublicCimdAddress("2001:4860:4860::8888"), true);
});

test("CIMD requires exact URL identity and valid redirects/authentication", () => {
  assert.deepEqual(validateCimdDocument(clientId, metadata).redirectUris, [redirectUri]);
  assert.deepEqual(validateCimdDocument(clientId, metadata).allowedScopes, ["api:read", "api:write", "mcp:read", "mcp:write", "sessions:read"]);
  for (const invalid of [
    { ...metadata, client_id: "https://evil.example.org/client.json" },
    { ...metadata, redirect_uris: ["http://internal.example.org/callback"] },
    { ...metadata, redirect_uris: [] },
    { ...metadata, token_endpoint_auth_method: "client_secret_basic" },
    { ...metadata, client_secret: "not-allowed" },
    { ...metadata, grant_types: ["client_credentials"] },
    { ...metadata, scope: "mcp:read" },
    { ...metadata, redirect_uris: [redirectUri, redirectUri] },
  ]) assert.throws(() => validateCimdDocument(clientId, invalid), { code: "invalid_client" });
});

test("Claude Web CIMD accepts extra advertised grant without enabling it", () => {
  // Public metadata observed at https://claude.ai/oauth/mcp-oauth-client-metadata.
  const claudeId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
  const result = validateCimdDocument(claudeId, {
    client_id: claudeId,
    client_name: "Claude",
    client_uri: "https://claude.ai",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  assert.deepEqual(result.redirectUris, ["https://claude.ai/api/mcp/auth_callback"]);
  assert.deepEqual(result.grantTypes, ["authorization_code", "refresh_token"]);
});

test("CIMD never enables unsupported-only, duplicate or malformed grant metadata", () => {
  for (const grants of [
    ["urn:ietf:params:oauth:grant-type:jwt-bearer"],
    ["authorization_code", "authorization_code"],
    ["authorization_code", 12],
    Array(17).fill("other"),
  ]) {
    assert.throws(() => validateCimdDocument(clientId, { ...metadata, grant_types: grants }), { code: "invalid_client" });
  }
});

test("first CIMD use persists published URL as stable client_id, without client secret", async () => {
  let stored: OAuthClientRecord | null = null;
  const resolver = createCimdClientResolver({
    fetchDocument: async () => metadata,
    findClient: async () => stored,
    persist: async (input) => {
      assert.equal(input.clientId, clientId);
      assert.equal(input.name, "Published identity");
      assert.deepEqual(input.redirectUris, [redirectUri]);
      stored = { ...existingClient, allowedScopes: input.allowedScopes };
      return stored;
    },
  });
  const result = await resolver(clientId);
  assert.equal(result.clientId, clientId);
  assert.equal(result.isConfidential, false);
  assert.deepEqual(result.redirectUris, [redirectUri]);
});

test("existing CIMD uses intersection with freshly published redirect URIs and scopes", async () => {
  const resolver = createCimdClientResolver({
    fetchDocument: async () => ({ ...metadata, redirect_uris: [redirectUri, extraRedirect], scope: readScopes.join(" ") }),
    findClient: async () => existingClient,
    persist: async () => { throw new Error("must not persist again"); },
  });
  const result = await resolver(clientId);
  assert.deepEqual(result.redirectUris, [redirectUri]);
  assert.deepEqual(result.allowedScopes, readScopes);
});

test("disabled, stale, malformed, and conflicting CIMD clients fail closed", async () => {
  for (const existing of [
    { ...existingClient, isActive: false },
    { ...existingClient, isConfidential: true },
    { ...existingClient, redirectUris: [extraRedirect] },
  ]) {
    const resolver = createCimdClientResolver({
      fetchDocument: async () => metadata,
      findClient: async () => existing,
    });
    await assert.rejects(resolver(clientId), { code: "invalid_client" });
  }
  const unavailable = createCimdClientResolver({
    fetchDocument: async () => { throw new Error("timeout"); },
    findClient: async () => null,
  });
  await assert.rejects(unavailable(clientId), /timeout/);
  const spoofed = createCimdClientResolver({
    fetchDocument: async () => ({ ...metadata, client_id: "https://evil.example.org/client.json" }),
    findClient: async () => existingClient,
  });
  await assert.rejects(spoofed(clientId), { code: "invalid_client" });
});
