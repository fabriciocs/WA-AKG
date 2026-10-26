import test from "node:test";
import assert from "node:assert/strict";
import {
  appOrigin,
  authorizationRedirectWithIssuer,
  mcpResourceUrl,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  requestOriginFromNodeRequest,
} from "../oauth/discovery.mjs";

test("authorization redirects carry the exact issuer for RFC 9207 clients", () => {
  const redirect = authorizationRedirectWithIssuer(
    "https://chatgpt.com/connector_platform_oauth_redirect?state=state-value&iss=attacker-value",
    "https://wa-akg.example.test/wa-akg",
  );
  assert.equal(redirect.searchParams.get("state"), "state-value");
  assert.equal(redirect.searchParams.get("iss"), "https://wa-akg.example.test/wa-akg");
});

test("discovery defaults to the request origin when no canonical origin is configured", () => {
  const metadata = protectedResourceMetadata({
    requestOrigin: "https://wa-akg.example.test:8443",
    endpointPath: "/mcp",
  });
  assert.equal(metadata.resource, "https://wa-akg.example.test:8443/mcp");
  assert.deepEqual(metadata.authorization_servers, ["https://wa-akg.example.test:8443"]);
});

test("explicit OAuth issuer remains separate from the WA-AKG public origin", () => {
  const metadata = protectedResourceMetadata({
    configuredOrigin: "https://wa-akg.example.test/ignored/path",
    requestOrigin: "http://internal:3030",
    configuredIssuer: "https://identity.example.test/tenant/",
    endpointPath: "/mcp",
  });
  assert.equal(metadata.resource, "https://wa-akg.example.test/mcp");
  assert.deepEqual(metadata.authorization_servers, ["https://identity.example.test/tenant"]);
});

test("explicit OAuth issuer preserves valid paths and rejects query strings or fragments", () => {
  assert.throws(() => protectedResourceMetadata({
    configuredOrigin: "https://wa-akg.example.test",
    configuredIssuer: "https://identity.example.test/tenant?mode=invalid",
  }), /Invalid OAuth issuer URL/);
  assert.throws(() => protectedResourceMetadata({
    configuredOrigin: "https://wa-akg.example.test",
    configuredIssuer: "https://identity.example.test/tenant#fragment",
  }), /Invalid OAuth issuer URL/);
  const metadata = protectedResourceMetadata({
    configuredOrigin: "https://wa-akg.example.test",
    configuredIssuer: "https://identity.example.test/tenant///",
  });
  assert.deepEqual(metadata.authorization_servers, ["https://identity.example.test/tenant"]);
});

test("fallback OAuth issuer uses the public origin and app base path", () => {
  const metadata = protectedResourceMetadata({
    configuredOrigin: "https://wa-akg.example.test/wa-akg/api/auth",
    requestOrigin: "http://localhost:8080",
    basePath: "/wa-akg/",
    endpointPath: "/mcp",
  });
  assert.deepEqual(metadata.authorization_servers, ["https://wa-akg.example.test/wa-akg"]);
  assert.equal(metadata.resource, "https://wa-akg.example.test/wa-akg/mcp");
});

test("basePath is included once in metadata, challenge URL, and configured MCP endpoint", () => {
  const basePath = "/wa-akg/";
  assert.equal(
    protectedResourceMetadataUrl({ origin: "https://wa-akg.example.test", basePath }),
    "https://wa-akg.example.test/wa-akg/.well-known/oauth-protected-resource",
  );
  assert.equal(
    mcpResourceUrl({ origin: "https://wa-akg.example.test", basePath, endpointPath: "/mcp" }),
    "https://wa-akg.example.test/wa-akg/mcp",
  );
  assert.equal(
    mcpResourceUrl({ origin: "https://wa-akg.example.test", basePath, endpointPath: "/wa-akg/mcp" }),
    "https://wa-akg.example.test/wa-akg/mcp",
  );
});

test("request-origin fallback accepts a validated Host and protocol, never forwarded Host", () => {
  assert.equal(appOrigin({ requestOrigin: "https://public.example.test:443/path" }), "https://public.example.test");
  assert.equal(requestOriginFromNodeRequest({ headers: { host: "public.example.test:43000", "x-forwarded-proto": "https, http" } }), "https://public.example.test:43000");
  assert.equal(requestOriginFromNodeRequest({ headers: { host: "attacker.example.test", "x-forwarded-host": "trusted.example.test" } }), "http://attacker.example.test");
  assert.equal(requestOriginFromNodeRequest({ headers: { host: "attacker.example.test/path" } }), "http://localhost");
  assert.equal(requestOriginFromNodeRequest({ headers: { host: "attacker.example.test, trusted.example.test" } }), "http://localhost");
});
