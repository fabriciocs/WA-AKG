import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { addNgrokSkipWarningHeader, createMcpServer, initializeMcpServer } from "./server.mjs";
import { appOrigin, normalizeBasePath, protectedResourceMetadataUrl, requestOriginFromNodeRequest } from "../../../src/lib/oauth/discovery.mjs";

export const endpointPath = process.env.WA_AKG_MCP_HTTP_PATH || "/mcp";
const maxBodyBytes = 1024 * 1024;
const maxSessions = 500;
const sessionIdleTtlMs = 30 * 60_000;
const sessions = new Map();

async function cleanupSessions() {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastSeenAt <= sessionIdleTtlMs) continue;
    sessions.delete(id);
    try { await entry.transport.close(); } catch { /* already closed */ }
  }
}

function apiBaseUrl() {
  const raw = process.env.WA_AKG_API_BASE_URL ?? "http://127.0.0.1:3030/api";
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid WA_AKG_API_BASE_URL");
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (process.env.WA_AKG_MCP_ALLOW_REMOTE_API !== "true" && !loopback) {
    throw new Error("Remote API targets are disabled");
  }
  if (!loopback && url.protocol !== "https:") throw new Error("Remote WA-AKG API targets must use HTTPS");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

async function authenticate(req) {
  const token = /^Bearer\s+([^\s]+)$/i.exec(req.headers.authorization ?? "")?.[1];
  if (!token) return null;
  const baseUrl = apiBaseUrl();
  const userInfoUrl = `${baseUrl.toString().replace(/\/$/, "")}/oauth/userinfo`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(userInfoUrl, {
      headers: addNgrokSkipWarningHeader({ Accept: "application/json", Authorization: `Bearer ${token}` }, baseUrl),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) return null;
    const info = await response.json();
    const scopes = info?.wa_akg?.scope;
    if (typeof info?.sub !== "string" || !Array.isArray(scopes) || !scopes.includes("mcp:read")) return null;
    const sessionScope = info?.wa_akg?.session_scope;
    return { accessToken: token, userId: info.sub, clientId: info.wa_akg.client_id, scopes, ...(Array.isArray(sessionScope) ? { sessionScope } : {}) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

function unauthorized(res, req, basePath) {
  const origin = appOrigin({
    configuredOrigin: process.env.BASE_URL,
    requestOrigin: requestOriginFromNodeRequest(req),
  });
  const metadataUrl = protectedResourceMetadataUrl({ origin, basePath });
  res.writeHead(401, {
    "Content-Type": "application/json",
    "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", error="invalid_token"`,
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

export async function createMcpHttpHandler({ basePath = process.env.NEXT_PUBLIC_BASE_PATH || "" } = {}) {
  if (process.env.WA_AKG_MCP_ENABLED !== "true") throw new Error("MCP HTTP endpoint is disabled; set WA_AKG_MCP_ENABLED=true to enable it");
  apiBaseUrl();
  const normalizedBasePath = normalizeBasePath(basePath);

  return async function handleMcpHttp(req, res) {
    await cleanupSessions();
    const authContext = await authenticate(req);
    if (!authContext) {
      unauthorized(res, req, normalizedBasePath);
      return true;
    }
    let body;
    try {
      body = await readJsonBody(req);
      const sessionId = req.headers["mcp-session-id"];
      const entry = sessionId ? sessions.get(sessionId) : undefined;
      let transport = entry?.transport;
      let credential = entry?.credential;
      let sessionEntry = entry;

      if (entry && (entry.authContext.userId !== authContext.userId || entry.authContext.clientId !== authContext.clientId)) {
        res.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "MCP session belongs to another OAuth client or user" }));
        return true;
      }
      if (entry) {
        credential.accessToken = authContext.accessToken;
        credential.scopes = authContext.scopes;
        credential.sessionScope = authContext.sessionScope;
        entry.lastSeenAt = Date.now();
      }

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
        if (sessions.size >= maxSessions) {
          res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: "MCP session capacity reached" }));
          return true;
        }
        const mcpServer = createMcpServer();
        credential = { accessToken: authContext.accessToken, scopes: authContext.scopes };
        await initializeMcpServer(mcpServer, credential);
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
        const currentTransport = transport;
        transport.onclose = () => {
          if (currentTransport.sessionId) sessions.delete(currentTransport.sessionId);
        };
        await mcpServer.connect(transport);
        sessionEntry = { transport, authContext: { ...authContext }, credential, lastSeenAt: Date.now() };
      }

      res.setHeader("Cache-Control", "no-store");
      await transport.handleRequest(req, res, body);
      if (transport.sessionId) {
        sessionEntry.authContext = { ...authContext };
        sessionEntry.lastSeenAt = Date.now();
        sessions.set(transport.sessionId, sessionEntry);
      }
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
