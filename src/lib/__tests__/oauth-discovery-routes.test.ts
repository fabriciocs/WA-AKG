import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as getAuthorizationServerMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as getProtectedResourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { proxy } from "@/proxy";

test("authorization-server metadata advertises only implemented grants", async () => {
  const response = getAuthorizationServerMetadata(new NextRequest("https://wa-akg.example.test/.well-known/oauth-authorization-server"));
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.deepEqual(metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.equal(metadata.grant_types_supported.includes("client_credentials"), false);
});

test("protected-resource metadata advertises scope dependencies required for MCP delegation", async () => {
  const response = getProtectedResourceMetadata(new NextRequest("https://wa-akg.example.test/.well-known/oauth-protected-resource"));
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.deepEqual(metadata.scopes_supported, ["api:read", "api:write", "mcp:read", "mcp:write", "sessions:read"]);
});

test("authorization-server metadata is reachable without an authenticated session", async () => {
  const response = await proxy(new NextRequest("https://wa-akg.example.test/.well-known/oauth-authorization-server"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("location"), null);
});

test("discovery routes share the BASE_URL issuer and include basePath once", async (t) => {
  const keys = ["OAUTH_ISSUER_URL", "NEXTAUTH_URL", "BASE_URL", "NEXT_PUBLIC_BASE_PATH"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  delete process.env.OAUTH_ISSUER_URL;
  process.env.NEXTAUTH_URL = "http://localhost:8080/wa-akg/api/auth";
  process.env.BASE_URL = "https://wa-akg.example.test/wa-akg/api/auth";
  process.env.NEXT_PUBLIC_BASE_PATH = "/wa-akg";

  const request = new NextRequest("http://localhost:8080/wa-akg/.well-known/oauth-authorization-server");
  const authorizationResponse = getAuthorizationServerMetadata(request);
  const authorization = await authorizationResponse.json();
  const resourceResponse = getProtectedResourceMetadata(request);
  const resource = await resourceResponse.json();

  assert.equal(authorization.issuer, "https://wa-akg.example.test/wa-akg");
  assert.equal(authorization.authorization_endpoint, "https://wa-akg.example.test/wa-akg/api/oauth/authorize");
  assert.equal(authorization.token_endpoint, "https://wa-akg.example.test/wa-akg/api/oauth/token");
  assert.equal(authorization.revocation_endpoint, "https://wa-akg.example.test/wa-akg/api/oauth/revoke");
  assert.equal(authorization.introspection_endpoint, "https://wa-akg.example.test/wa-akg/api/oauth/introspect");
  assert.deepEqual(resource.authorization_servers, [authorization.issuer]);
  assert.equal(resource.resource, "https://wa-akg.example.test/wa-akg/mcp");
});
