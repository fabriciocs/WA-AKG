import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, initializeMcpServer } from "./server.mjs";

export const endpointPath = process.env.WA_AKG_MCP_HTTP_PATH || "/mcp";
const maxBodyBytes = 1024 * 1024;
const sessions = new Map();

function validBearerToken(req, configuredToken) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (!match || !configuredToken) return false;
  const actual = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(configuredToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJsonBody(req) {
  if (req.method !== "POST") return undefined;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw Object.assign(new Error("MCP request body too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (bytes === 0) return undefined;
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/json")) throw Object.assign(new Error("Content-Type must be application/json"), { statusCode: 415 });
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON request body"), { statusCode: 400 }); }
}

export async function createMcpHttpHandler() {
  if (process.env.WA_AKG_MCP_ENABLED !== "true") throw new Error("MCP HTTP endpoint is disabled; set WA_AKG_MCP_ENABLED=true to enable it");
  const token = process.env.WA_AKG_MCP_HTTP_TOKEN?.trim();
  if (!token || token.length < 32) throw new Error("WA_AKG_MCP_HTTP_TOKEN must be configured with at least 32 characters when MCP HTTP is enabled");

  return async function handleMcpHttp(req, res) {
    if (!validBearerToken(req, token)) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      const sessionId = req.headers["mcp-session-id"];
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        if (sessionId) {
          res.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: "Unknown MCP session" }));
          return true;
        }
        if (req.method !== "POST" || body?.method !== "initialize") {
          res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: "A new MCP session must start with an initialize request" }));
          return true;
        }
        const mcpServer = createMcpServer();
        await initializeMcpServer(mcpServer);
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
        transport.onclose = () => {
          if (transport?.sessionId) sessions.delete(transport.sessionId);
        };
        await mcpServer.connect(transport);
      }

      res.setHeader("Cache-Control", "no-store");
      await transport.handleRequest(req, res, body);
      if (transport.sessionId) sessions.set(transport.sessionId, transport);
      if (req.method === "DELETE" && sessionId) sessions.delete(sessionId);
    } catch (error) {
      if (!res.headersSent) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "MCP request failed" }));
      } else if (!res.writableEnded) res.end();
    }
    return true;
  };
}
