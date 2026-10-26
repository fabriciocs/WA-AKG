import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.WA_AKG_MCP_WRITE_ALLOWLIST = "POST /messages/{sessionId}/{jid}/send";
const { addNgrokSkipWarningHeader, isAllowedOperation } = await import("../src/server.mjs");

test("server contains protocol, allowlist and network safeguards", async () => {
  const source = await readFile(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(source, /StdioServerTransport/);
  assert.match(source, /WA_AKG_MCP_WRITE_ALLOWLIST/);
  assert.match(source, /redirect: "error"/);
  assert.match(source, /isLoopbackHost/);
});

test("write operations require exact explicit method/path allowlist", async () => {
  const source = await readFile(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(source, /if \(!writeAllowlist\.has\(operationKey\(method, route\)\)\) return false/);
  assert.match(source, /scopes\.includes\("mcp:write"\) && scopes\.includes\("api:write"\)/);
});

test("default OpenAPI path points to the repository swagger file", async () => {
  const source = await readFile(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(source, /\.\.\/\.\.\/\.\.\/swagger\.json/);
});

test("ngrok warning bypass header is scoped to ngrok-free.dev upstream hosts", () => {
  const ngrokHeaders = addNgrokSkipWarningHeader({ Accept: "application/json" }, new URL("https://wa-akg.example.ngrok-free.dev/api"));
  const normalHeaders = addNgrokSkipWarningHeader({ Accept: "application/json" }, new URL("https://api.example.test/api"));
  assert.equal(ngrokHeaders["ngrok-skip-browser-warning"], "true");
  assert.equal(normalHeaders["ngrok-skip-browser-warning"], undefined);
});

test("OAuth MCP tools require read scope and writes require both MCP and API write scopes", () => {
  assert.equal(isAllowedOperation("get", "/sessions", { scopes: ["mcp:read"] }), false);
  assert.equal(isAllowedOperation("get", "/sessions", { scopes: ["mcp:read", "sessions:read"] }), true);
  assert.equal(isAllowedOperation("get", "/messages/{sessionId}/search", { scopes: ["mcp:read", "api:read"] }), true);
  assert.equal(isAllowedOperation("get", "/sessions", { scopes: ["sessions:read"] }), false);
  assert.equal(isAllowedOperation("post", "/messages/{sessionId}/{jid}/send", { scopes: ["mcp:read"] }), false);
  assert.equal(isAllowedOperation("post", "/messages/{sessionId}/{jid}/send", { scopes: ["mcp:read", "mcp:write"] }), false);
  assert.equal(isAllowedOperation("post", "/messages/{sessionId}/{jid}/send", { scopes: ["mcp:read", "mcp:write", "api:write"] }), true);
  assert.equal(isAllowedOperation("post", "/messages/{sessionId}/{jid}/send", undefined), true);
});
