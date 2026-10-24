import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("MCP initializes, lists safe tools and reports runtime metadata", async () => {
  const client = new Client({ name: "wa-akg-mcp-smoke-test", version: "0.0.1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "src", "server.mjs")],
    cwd: root,
    env: {
      ...process.env,
      WA_AKG_API_BASE_URL: "http://127.0.0.1:3000/api",
      WA_AKG_API_KEY: "",
      WA_AKG_MCP_WRITE_ALLOWLIST: "",
      WA_AKG_MCP_ALLOW_REMOTE_API: "false"
    }
  });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name);
    assert.ok(names.includes("wa_akg_server_info"));
    assert.ok(names.includes("wa_akg_get_sessions"));
    assert.ok(names.some((name) => name.startsWith("wa_akg_get_")));
    assert.equal(names.some((name) => /_post_|_put_|_patch_|_delete_/.test(name)), false);

    const info = await client.callTool({ name: "wa_akg_server_info", arguments: {} });
    const metadata = JSON.parse(info.content[0].text);
    assert.equal(metadata.server, "wa-akg-mcp");
    assert.equal(metadata.writeToolsEnabled, false);
    assert.ok(metadata.registeredApiTools > 0);
  } finally {
    await client.close();
  }
});
