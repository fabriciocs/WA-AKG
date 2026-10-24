import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("server contains protocol, allowlist and network safeguards", async () => {
  const source = await readFile(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(source, /StdioServerTransport/);
  assert.match(source, /WA_AKG_MCP_WRITE_ALLOWLIST/);
  assert.match(source, /redirect: "error"/);
  assert.match(source, /isLoopbackHost/);
});

test("write operations require exact explicit method/path allowlist", async () => {
  const source = await readFile(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(source, /return writeAllowlist\.has\(operationKey\(method, route\)\)/);
});

test("default OpenAPI path points to the repository swagger file", async () => {
  const source = await readFile(path.join(root, "src", "server.mjs"), "utf8");
  assert.match(source, /\.\.\/\.\.\/\.\.\/swagger\.json/);
});
