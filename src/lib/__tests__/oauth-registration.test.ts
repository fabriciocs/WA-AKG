import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createAuthorizationRequest } from "@/lib/oauth/service";
import { validateRedirectUri } from "@/lib/oauth/crypto";
import { hasCompatibleScopeSet } from "@/lib/oauth/scopes";
import { OAuthScope } from "@/lib/oauth/types";
import { createDcrRegistrationHandler, isSafeDcrRedirectUri } from "@/lib/oauth/dcr-registration";
import { createDcrRegistrationRateLimiter, trustedProxyClientIp } from "@/lib/oauth/dcr-rate-limit";

const readScope = [OAuthScope.MCP_READ, OAuthScope.API_READ, OAuthScope.SESSIONS_READ];
const validMetadata = {
  client_name: "Codex CLI",
  redirect_uris: ["http://127.0.0.1:43123/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  scope: readScope.join(" "),
};

function makeHandler() {
  const persisted: Array<Record<string, unknown>> = [];
  const handler = createDcrRegistrationHandler({
    checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
    now: () => 1_800_000_000_000,
    persistClient: async (input) => {
      persisted.push(input);
      return {
        client: {
          id: "oauth-client-db-id",
          clientId: "public-dcr-client-id",
          name: input.name,
          description: input.description ?? null,
          redirectUris: input.redirectUris,
          allowedScopes: input.allowedScopes,
          grantTypes: input.grantTypes,
          isConfidential: input.isConfidential,
          isActive: true,
        },
        clientSecret: undefined,
      };
    },
  });
  return { handler, persisted };
}

function registrationRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://wa-akg.example.test/api/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.20", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("DCR registers a public client with read-only scopes and returns no secret", async () => {
  const { handler, persisted } = makeHandler();
  const response = await handler(registrationRequest(validMetadata));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.client_id, "public-dcr-client-id");
  assert.equal(body.client_id_issued_at, 1_800_000_000);
  assert.equal(body.client_name, "Codex CLI");
  assert.deepEqual(body.redirect_uris, validMetadata.redirect_uris);
  assert.deepEqual(body.grant_types, validMetadata.grant_types);
  assert.deepEqual(body.response_types, ["code"]);
  assert.equal(body.token_endpoint_auth_method, "none");
  assert.equal(body.scope, readScope.join(" "));
  assert.equal(Object.hasOwn(body, "client_secret"), false);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].isConfidential, false);
  assert.equal(persisted[0].createdById, null);
  assert.deepEqual(persisted[0].allowedScopes, readScope);
  assert.equal(persisted[0].clientSecret, undefined);
});

test("DCR applies safe redirect rules and keeps exact redirects usable by authorization", async () => {
  assert.equal(isSafeDcrRedirectUri("https://codex.example.test/oauth/callback"), true);
  assert.equal(isSafeDcrRedirectUri("http://localhost:43123/callback"), true);
  assert.equal(isSafeDcrRedirectUri("http://127.0.0.1:43123/callback"), true);
  assert.equal(isSafeDcrRedirectUri("http://[::1]:43123/callback"), true);
  assert.equal(isSafeDcrRedirectUri("http://public.example.test/callback"), false);
  assert.equal(isSafeDcrRedirectUri("https://user:pass@codex.example.test/callback"), false);
  assert.equal(isSafeDcrRedirectUri("https://@codex.example.test/callback"), false);
  assert.equal(isSafeDcrRedirectUri("https://codex.example.test/callback#fragment"), false);

  const { handler, persisted } = makeHandler();
  const response = await handler(registrationRequest(validMetadata));
  assert.equal(response.status, 201);
  const client = persisted[0];
  assert.equal(validateRedirectUri(validMetadata.redirect_uris[0], client.redirectUris as string[]), true);
  assert.equal(hasCompatibleScopeSet(client.allowedScopes as string[]), true);
});

test("DCR defaults to public authorization-code and refresh-token client metadata", async () => {
  const { handler, persisted } = makeHandler();
  const response = await handler(registrationRequest({ redirect_uris: validMetadata.redirect_uris }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body.grant_types, ["authorization_code", "refresh_token"]);
  assert.deepEqual(body.response_types, ["code"]);
  assert.equal(body.token_endpoint_auth_method, "none");
  assert.deepEqual(persisted[0].allowedScopes, readScope);
});

test("DCR permits explicitly requested compatible write scopes", async () => {
  const writeScopes = [...readScope, OAuthScope.MCP_WRITE, OAuthScope.API_WRITE];
  const { handler, persisted } = makeHandler();
  const response = await handler(registrationRequest({ ...validMetadata, scope: writeScopes.join(" ") }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.scope, writeScopes.join(" "));
  assert.deepEqual(persisted[0].allowedScopes, writeScopes);
});

test("DCR rejects invalid redirects, unsupported grants, methods and incompatible scopes", async () => {
  const invalidCases = [
    { ...validMetadata, redirect_uris: [] },
    { ...validMetadata, redirect_uris: ["http://public.example.test/callback"] },
    { ...validMetadata, redirect_uris: ["https://user:pass@codex.example.test/callback"] },
    { ...validMetadata, redirect_uris: ["https://codex.example.test/callback#fragment"] },
    { ...validMetadata, redirect_uris: ["not-a-url"] },
    { ...validMetadata, redirect_uris: ["https://codex.example.test/callback", "https://codex.example.test/callback"] },
    { ...validMetadata, grant_types: ["client_credentials"] },
    { ...validMetadata, response_types: ["token"] },
    { ...validMetadata, token_endpoint_auth_method: "client_secret_basic" },
    { ...validMetadata, scope: "mcp:read mcp:write api:read" },
    { ...validMetadata, scope: "mcp:read" },
  ];

  for (const invalid of invalidCases) {
    const { handler, persisted } = makeHandler();
    const response = await handler(registrationRequest(invalid));
    const body = await response.json();
    assert.equal(response.status, 400, JSON.stringify(invalid));
    assert.equal(body.error, "invalid_client_metadata");
    assert.equal(persisted.length, 0);
  }
});

test("DCR rejects malformed, wrong-content-type and oversized metadata", async () => {
  const { handler, persisted } = makeHandler();
  const malformed = await handler(registrationRequest("{"));
  assert.equal(malformed.status, 400);

  const wrongType = await handler(registrationRequest(validMetadata, { "content-type": "text/plain" }));
  assert.equal(wrongType.status, 400);

  const oversized = await handler(registrationRequest("x".repeat(17 * 1024)));
  assert.equal(oversized.status, 413);
  assert.equal(persisted.length, 0);
});

test("DCR registration is rate-limited and returns Retry-After", async () => {
  const { handler, persisted } = makeHandler();
  const limited = createDcrRegistrationHandler({
    persistClient: async (input) => {
      persisted.push(input);
      throw new Error("must not persist a limited registration");
    },
    checkRateLimit: () => ({ allowed: false, retryAfterSeconds: 3600 }),
  });
  const response = await limited(registrationRequest(validMetadata));
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "3600");
  assert.equal(body.error, "rate_limited");
  assert.equal(persisted.length, 0);
  assert.equal((await handler(registrationRequest(validMetadata))).status, 201);
});

test("DCR rate limiter allows ten registrations per IP per hour and denies the next", () => {
  const limiter = createDcrRegistrationRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
  const start = 1_800_000_000_000;
  for (let i = 0; i < 10; i += 1) assert.equal(limiter("198.51.100.21", start + i).allowed, true);
  const denied = limiter("198.51.100.21", start + 10);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 3600);
  assert.equal(limiter("198.51.100.22", start + 11).allowed, true);
  assert.equal(limiter("198.51.100.21", start + 60 * 60 * 1000).allowed, true);
});

test("DCR uses the originating IP in the sanitized proxy chain", () => {
  const request = registrationRequest(validMetadata, { "x-forwarded-for": "203.0.113.7, 10.0.0.2" });
  assert.equal(trustedProxyClientIp(request), "203.0.113.7");
  const missing = new Request("https://wa-akg.example.test/api/oauth/register", { method: "POST" });
  assert.equal(trustedProxyClientIp(missing), "unknown");
});

test("a DCR client can start the existing PKCE authorization request", async () => {
  const { handler, persisted } = makeHandler();
  const response = await handler(registrationRequest(validMetadata));
  assert.equal(response.status, 201);
  const registered = persisted[0];
  const client = {
    id: "oauth-client-db-id",
    clientId: "public-dcr-client-id",
    name: String(registered.name),
    description: String(registered.description),
    redirectUris: registered.redirectUris as string[],
    allowedScopes: registered.allowedScopes as string[],
    grantTypes: registered.grantTypes as ("authorization_code" | "refresh_token")[],
    isConfidential: false,
    isActive: true,
  };
  const verifier = "a".repeat(43);
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const delegate = prisma.oAuthAuthorizationRequest;
  const originalDescriptor = Object.getOwnPropertyDescriptor(delegate, "create");
  let savedRequest: Record<string, unknown> | undefined;
  Object.defineProperty(delegate, "create", {
    configurable: true,
    value: async ({ data }: { data: Record<string, unknown> }) => {
      savedRequest = data;
      return data;
    },
  });
  try {
    const requestId = await createAuthorizationRequest({
      client,
      redirectUri: validMetadata.redirect_uris[0],
      scope: readScope,
      state: "state-value",
      codeChallenge: challenge,
      resource: "https://wa-akg.example.test/wa-akg/mcp",
    });
    assert.ok(requestId);
    assert.equal(savedRequest?.clientId, client.clientId);
    assert.equal(savedRequest?.redirectUri, validMetadata.redirect_uris[0]);
    assert.equal(savedRequest?.codeChallenge, challenge);
    assert.equal(savedRequest?.codeChallengeMethod, "S256");
    assert.deepEqual(savedRequest?.scope, readScope.join(" "));
  } finally {
    if (originalDescriptor) Object.defineProperty(delegate, "create", originalDescriptor);
    else delete (delegate as unknown as { create?: unknown }).create;
  }
});
