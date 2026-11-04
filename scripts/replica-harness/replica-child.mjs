import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";

const replicaId = process.env.HARNESS_REPLICA_ID || "replica";
const targetRepo = path.resolve(process.env.WA_AKG_HARNESS_TARGET_REPO || path.resolve(process.cwd(), "..", "WA-AKG"));
const expectedResource = process.env.HARNESS_RESOURCE;
const mcpPort = Number(process.env.HARNESS_MCP_PORT || 0);
const apiPort = Number(process.env.HARNESS_API_PORT || 0);
if (!expectedResource) throw new Error("HARNESS_RESOURCE is required");

const tokenFixtures = new Map([
  ["harness-token-user-a-read", { sub: "harness-user-a", clientId: "harness-client-a", tenantId: "tenant-a", grantId: "grant-a", scopes: ["mcp:read", "api:read", "sessions:read"], sessionScope: ["synthetic-session-a"], sessionCapabilities: { "synthetic-session-a": "READ" } }],
  ["harness-token-user-b-read", { sub: "harness-user-b", clientId: "harness-client-b", tenantId: "tenant-b", grantId: "grant-b", scopes: ["mcp:read", "api:read", "sessions:read"], sessionScope: ["synthetic-session-b"], sessionCapabilities: { "synthetic-session-b": "READ" } }],
  ["harness-token-user-c-read", { sub: "harness-user-c", clientId: "harness-client-c", tenantId: "tenant-a", grantId: "grant-c", scopes: ["mcp:read", "api:read", "sessions:read"], sessionScope: ["synthetic-session-c"], sessionCapabilities: { "synthetic-session-c": "READ" } }],
  ["harness-token-user-a-wrong-audience", { sub: "harness-user-a", clientId: "harness-client-a", tenantId: "tenant-a", grantId: "grant-a", scopes: ["mcp:read", "api:read", "sessions:read"], sessionScope: ["synthetic-session-a"], sessionCapabilities: { "synthetic-session-a": "READ" }, resource: `${expectedResource}/wrong` }],
]);
let createSessionRequests = 0;
function json(res, status, body) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); }
function bearerToken(req) { return /^Bearer\s+([^\s]+)$/i.exec(req.headers.authorization || "")?.[1] || ""; }
function fixtureForRequest(req) { const fixture = tokenFixtures.get(bearerToken(req)); return fixture ? { ...fixture, resource: fixture.resource || expectedResource } : null; }
function syntheticApiServer() {
  return createServer((req, res) => {
    const pathname = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`).pathname;
    if (pathname === "/api/oauth/userinfo") {
      const fixture = fixtureForRequest(req); if (!fixture) return json(res, 401, { error: "invalid_token" });
      return json(res, 200, { sub: fixture.sub, wa_akg: { client_id: fixture.clientId, tenant_id: fixture.tenantId, grant_id: fixture.grantId, scope: fixture.scopes, session_scope: fixture.sessionScope, session_capabilities: fixture.sessionCapabilities, resource: fixture.resource } });
    }
    if (pathname === "/api/sessions") {
      const fixture = fixtureForRequest(req); if (!fixture) return json(res, 401, { error: "invalid_token" });
      if (req.method !== "GET") { createSessionRequests += 1; return json(res, 405, { error: "synthetic fixture does not create sessions" }); }
      const sessionId = fixture.sessionScope[0];
      return json(res, 200, { status: true, data: [{ sessionId, name: `Synthetic ${fixture.sub.slice(-1).toUpperCase()}`, ownerId: fixture.sub }] });
    }
    if (pathname === "/__harness/state") return json(res, 200, { replicaId, createSessionRequests });
    return json(res, 404, { error: "synthetic fixture route not found" });
  });
}
function loopbackOnlyFetch() {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => { const url = new URL(String(input)); if (!(url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1")) throw new Error("replica harness blocked a non-loopback fetch"); return nativeFetch(input, init); };
}
async function main() {
  loopbackOnlyFetch();
  const apiServer = syntheticApiServer();
  await new Promise((resolve, reject) => { apiServer.once("error", reject); apiServer.listen(apiPort, "127.0.0.1", resolve); });
  const actualApiPort = apiServer.address().port;
  process.env.WA_AKG_MCP_ENABLED = "true";
  process.env.WA_AKG_MCP_HTTP_PATH = "/mcp";
  process.env.NEXT_PUBLIC_BASE_PATH = "/wa-akg";
  process.env.BASE_URL = "https://replica-harness.invalid";
  process.env.OAUTH_ISSUER_URL = "https://replica-harness.invalid/wa-akg";
  process.env.WA_AKG_API_BASE_URL = `http://127.0.0.1:${actualApiPort}/api`;
  process.env.WA_AKG_MCP_ALLOW_REMOTE_API = "false";
  process.env.WA_AKG_API_KEY = "";
  process.env.WA_AKG_OPENAPI_PATH = path.join(targetRepo, "swagger.json");
  const httpModule = await import(pathToFileURL(path.join(targetRepo, "mcp", "wa-akg-mcp", "src", "http.mjs")).href);
  const handler = await httpModule.createMcpHttpHandler({ basePath: "/wa-akg" });
  const mcpServer = createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`).pathname;
    if (pathname === "/mcp") return void await handler(req, res);
    if (pathname === "/__harness/state") return json(res, 200, { replicaId, createSessionRequests });
    return json(res, 404, { error: "synthetic MCP fixture route not found" });
  });
  await new Promise((resolve, reject) => { mcpServer.once("error", reject); mcpServer.listen(mcpPort, "127.0.0.1", resolve); });
  process.stdout.write(`${JSON.stringify({ kind: "ready", replicaId, port: mcpServer.address().port })}\n`);
  const close = async () => Promise.all([new Promise(resolve => apiServer.close(resolve)), new Promise(resolve => mcpServer.close(resolve))]);
  const shutdown = () => { const hardStop = setTimeout(() => process.exit(0), 1000); void close().finally(() => { clearTimeout(hardStop); process.exit(0); }); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}
main().catch(error => { process.stderr.write(`replica-child failed: ${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode = 1; });
