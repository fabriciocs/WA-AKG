import assert from "node:assert/strict";
import test from "node:test";
import { isLiveWhatsAppSession, validateMcpDiscovery } from "../onboarding-health";

const origin = "https://gateway.example";
const issuer = origin + "/wa-akg";
const resource = issuer + "/mcp";
const auth = {
  issuer,
  authorization_endpoint: issuer + "/api/oauth/authorize",
  token_endpoint: issuer + "/api/oauth/token",
  code_challenge_methods_supported: ["S256"],
};
const metadata = { resource, authorization_servers: [issuer] };

test("WhatsApp onboarding requires an actually running connected instance", () => {
  assert.equal(isLiveWhatsAppSession({ status: "CONNECTED", hasInstance: true, isLiveConnected: true }), true);
  for (const value of [
    null, {}, { status: "CONNECTED" }, { status: "CONNECTED", hasInstance: false },
    { status: "CONNECTED", hasInstance: true }, { status: "CONNECTED", hasInstance: true, isLiveConnected: false },
    { status: "DISCONNECTED", hasInstance: true, isLiveConnected: true }, { status: "CONNECTED", hasInstance: "true" },
  ]) assert.equal(isLiveWhatsAppSession(value), false);
});

test("MCP onboarding accepts consistent prefixed OAuth discovery", () => {
  assert.deepEqual(validateMcpDiscovery(auth, metadata, origin), { ok: true, issuer, resource });
  assert.deepEqual(validateMcpDiscovery(auth, metadata, "http://localhost:8080"), { ok: true, issuer, resource });
});

test("MCP discovery fails closed when metadata is missing or inconsistent", () => {
  const scenarios: [unknown, unknown, string][] = [
    [null, metadata, origin],
    [auth, { ...metadata, resource: "https://attacker.example/mcp" }, origin],
    [auth, { ...metadata, authorization_servers: ["https://attacker.example"] }, origin],
    [{ ...auth, code_challenge_methods_supported: ["plain"] }, metadata, origin],
    [{ ...auth, token_endpoint: "https://attacker.example/token" }, metadata, origin],
    [{ ...auth, issuer: "http://gateway.example/wa-akg" }, metadata, origin],
    [auth, { resource: "not a url", authorization_servers: [issuer] }, origin],
  ];
  for (const [authorization, protectedResource, siteOrigin] of scenarios) {
    assert.equal(validateMcpDiscovery(authorization, protectedResource, siteOrigin).ok, false);
  }
});
