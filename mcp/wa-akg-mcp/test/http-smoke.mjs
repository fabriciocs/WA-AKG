import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const token = "test-token-for-wa-akg-mcp-http-endpoint-123456";
process.env.WA_AKG_MCP_ENABLED = "true";
process.env.WA_AKG_MCP_HTTP_TOKEN = token;
process.env.WA_AKG_MCP_HTTP_PATH = "/mcp";
process.env.WA_AKG_API_BASE_URL = "http://127.0.0.1:3030/api";
process.env.WA_AKG_API_KEY = "";
process.env.WA_AKG_MCP_WRITE_ALLOWLIST = "";
process.env.WA_AKG_MCP_ALLOW_REMOTE_API = "false";

const { createMcpHttpHandler } = await import("../src/http.mjs");

test("HTTP MCP endpoint enforces bearer auth and supports MCP initialization/tool discovery", async () => {
  const handler = await createMcpHttpHandler();
  const httpServer = createServer(async (req, res) => {
    if (req.url === "/mcp") return void await handler(req, res);
    res.writeHead(404).end();
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const url = `http://127.0.0.1:${address.port}/mcp`;
  try {
    const denied = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } })
    });
    assert.equal(denied.status, 401);

    const initialized = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } })
    });
    const initText = await initialized.text();
    assert.equal(initialized.status, 200, initText);
    assert.match(initText, /serverInfo|wa-akg-mcp/);
    const sessionId = initialized.headers.get("mcp-session-id");
    assert.ok(sessionId, "initialize response should return an MCP session ID");

    const notification = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Mcp-Session-Id": sessionId, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    const notificationText = await notification.text();
    assert.equal(notification.status, 202, notificationText);

    const listed = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Mcp-Session-Id": sessionId, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    assert.equal(listed.status, 200);
    const listText = await listed.text();
    assert.match(listText, /wa_akg_server_info/);
    assert.match(listText, /wa_akg_get_sessions/);
    assert.doesNotMatch(listText, /wa_akg_post_/);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
