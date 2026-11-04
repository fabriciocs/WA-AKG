/** Explicit opt-in, read-only live MCP smoke. Never logs API keys or session data. */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.WA_AKG_API_KEY?.trim()) {
  console.error("BLOCKED: WA_AKG_API_KEY is not available in this process.");
  process.exit(2);
}
const client = new Client({ name: "wa-akg-mcp-live-readonly-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "src", "server.mjs")],
  cwd: root,
  env: {
    ...process.env,
    WA_AKG_MCP_CREDENTIAL_CAPABILITIES: "",
    WA_AKG_MCP_ALLOW_REMOTE_API: "false",
  },
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map(({ name }) => name);
  assert.ok(names.includes("wa_akg_server_info"), "server info tool missing");
  assert.ok(names.includes("wa_akg_get_sessions"), "sessions tool missing");
  assert.ok(!names.some((name) => /_post_|_patch_|_put_|_delete_/.test(name)), "write tool exposed");
  const info = await client.callTool({ name: "wa_akg_server_info", arguments: {} });
  assert.equal(info.isError, undefined, "server info tool failed");
  const state = JSON.parse(info.content.find((item) => item.type === "text")?.text ?? "{}");
  assert.equal(state.apiKeyConfigured, true, "API key not loaded");
  assert.equal(state.writeToolsEnabled, false, "write tools unexpectedly enabled");
  const result = await client.callTool({ name: "wa_akg_get_sessions", arguments: {} });
  assert.notEqual(result.isError, true, "read-only session tool returned an error");
  const response = JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}");
  assert.equal(response.status, 200, "WA-AKG API did not answer HTTP 200");
  assert.equal(response.data?.status, true, "WA-AKG API did not confirm session listing");
  const sessions = response.data?.data;
  assert.ok(Array.isArray(sessions), "unexpected WA-AKG sessions response");
  console.log(JSON.stringify({ status: "VERIFIED", transport: "stdio", handshake: true, toolList: true, apiDelegation: true, readOnly: true, toolCount: names.length, sessionCount: sessions.length }));
} catch (error) {
  // Never print the tool response: it may include session contents or private headers.
  console.error("NOT_VERIFIED: live MCP read-only delegation failed (" + (error?.code || error?.name || "UnknownError") + ")");
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
