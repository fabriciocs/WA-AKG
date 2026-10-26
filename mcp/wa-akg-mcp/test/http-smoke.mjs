import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const token = "test-token-for-wa-akg-mcp-http-endpoint-123456";
process.env.WA_AKG_MCP_ENABLED = "true";
process.env.WA_AKG_MCP_HTTP_PATH = "/mcp";
process.env.NEXT_PUBLIC_BASE_PATH = "/wa-akg";
process.env.BASE_URL = "https://wa-akg.example.test";
process.env.WA_AKG_API_BASE_URL = "http://127.0.0.1:3030/api";
process.env.WA_AKG_API_KEY = "";
process.env.WA_AKG_MCP_WRITE_ALLOWLIST = "POST /messages/{sessionId}/{jid}/send";
process.env.WA_AKG_MCP_ALLOW_REMOTE_API = "false";

const { createMcpHttpHandler } = await import("../src/http.mjs");

test("HTTP MCP endpoint enforces bearer auth and supports MCP initialization/tool discovery", async () => {
  const originalFetch = globalThis.fetch;
  let tokenScopes = ["mcp:read", "api:read", "sessions:read"];
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/oauth/userinfo")) {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization !== `Bearer ${token}`) return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 });
      return new Response(JSON.stringify({ sub: "test-user", wa_akg: { client_id: "test-client", scope: tokenScopes } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  };
  const handler = await createMcpHttpHandler({ basePath: "/wa-akg" });
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
    assert.equal(
      denied.headers.get("www-authenticate"),
      'Bearer resource_metadata="https://wa-akg.example.test/wa-akg/.well-known/oauth-protected-resource", error="invalid_token"',
    );
    const configuredBaseUrl = process.env.BASE_URL;
    delete process.env.BASE_URL;
    const fallbackDenied = await fetch(url);
    assert.equal(fallbackDenied.status, 401);
    assert.equal(
      fallbackDenied.headers.get("www-authenticate"),
      `Bearer resource_metadata="http://127.0.0.1:${address.port}/wa-akg/.well-known/oauth-protected-resource", error="invalid_token"`,
    );
    process.env.BASE_URL = configuredBaseUrl;

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

    tokenScopes = ["mcp:read", "api:read", "sessions:read", "mcp:write", "api:write"];
    const writeInitialized = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "write-test", version: "1" } } })
    });
    assert.equal(writeInitialized.status, 200, await writeInitialized.clone().text());
    const writeSessionId = writeInitialized.headers.get("mcp-session-id");
    assert.ok(writeSessionId);
    const writeListed = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Mcp-Session-Id": writeSessionId, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} })
    });
    assert.equal(writeListed.status, 200);
    const writeListText = await writeListed.text();
    assert.match(writeListText, /wa_akg_post_messages_sessionid_jid_send/);
    assert.doesNotMatch(writeListText, /wa_akg_post_groups/);

    tokenScopes = ["mcp:read", "api:read", "api:write"];
    const revokedWrite = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Mcp-Session-Id": writeSessionId, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "wa_akg_post_messages_sessionid_jid_send", arguments: { sessionId: "test-session", jid: "test@example.com", body: { text: "mock-only" } } } })
    });
    assert.equal(revokedWrite.status, 200);
    assert.match(await revokedWrite.text(), /current OAuth token does not grant this MCP tool/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
