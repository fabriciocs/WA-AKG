import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultSpecPath = path.resolve(here, "../../../swagger.json");
const specPath = process.env.WA_AKG_OPENAPI_PATH ? path.resolve(process.env.WA_AKG_OPENAPI_PATH) : defaultSpecPath;
const apiKey = process.env.WA_AKG_API_KEY?.trim();
const timeoutMs = boundedInteger(process.env.WA_AKG_TIMEOUT_MS, 15000, 1000, 120000);
const maxResponseBytes = boundedInteger(process.env.WA_AKG_MAX_RESPONSE_BYTES, 1000000, 1024, 10000000);
const remoteApiAllowed = process.env.WA_AKG_MCP_ALLOW_REMOTE_API === "true";
const writeAllowlist = new Set((process.env.WA_AKG_MCP_WRITE_ALLOWLIST ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
export const server = new McpServer({ name: "wa-akg-mcp", version: "0.1.0" });
const initializedServers = new WeakSet();
const registeredCounts = new WeakMap();
export function createMcpServer() { return new McpServer({ name: "wa-akg-mcp", version: "0.1.0" }); }

function boundedInteger(raw, fallback, min, max) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Configuration value must be an integer between ${min} and ${max}`);
  return value;
}
function safeBaseUrl() {
  const raw = process.env.WA_AKG_API_BASE_URL ?? "http://127.0.0.1:3030/api";
  let url;
  try { url = new URL(raw); } catch { throw new Error("WA_AKG_API_BASE_URL must be a valid absolute URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("WA_AKG_API_BASE_URL must use HTTP or HTTPS");
  if (url.username || url.password) throw new Error("Do not place credentials in WA_AKG_API_BASE_URL; use WA_AKG_API_KEY");
  if (!remoteApiAllowed && !isLoopbackHost(url.hostname)) throw new Error("Remote API targets are disabled. Use loopback or explicitly set WA_AKG_MCP_ALLOW_REMOTE_API=true.");
  if (!isLoopbackHost(url.hostname) && url.protocol !== "https:") throw new Error("Remote WA-AKG API targets must use HTTPS");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}
function isLoopbackHost(host) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
function operationKey(method, route) { return `${method.toUpperCase()} ${route}`; }
export function addNgrokSkipWarningHeader(headers, target) {
  const url = target instanceof URL ? target : new URL(target);
  if (url.hostname.endsWith(".ngrok-free.dev")) headers["ngrok-skip-browser-warning"] = "true";
  return headers;
}
function toolName(method, route) {
  const slug = route.replace(/\{([^}]+)\}/g, "$1").split("/").filter(Boolean).join("_")
    .replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
  return `wa_akg_${method.toLowerCase()}_${slug || "root"}`;
}
function parameterSchema(parameter) {
  const schema = parameter.schema ?? {};
  let value;
  if (schema.type === "integer") value = z.number().int();
  else if (schema.type === "number") value = z.number();
  else if (schema.type === "boolean") value = z.boolean();
  else if (schema.type === "array") value = z.array(z.unknown());
  else value = z.string();
  if (Array.isArray(schema.enum) && schema.enum.length) value = z.enum(schema.enum.map(String));
  return parameter.required ? value : value.optional();
}
function createInputSchema(operation) {
  const shape = {};
  for (const parameter of operation.parameters ?? []) {
    if (!parameter?.name || !["path", "query", "header"].includes(parameter.in)) continue;
    shape[parameter.name] = parameterSchema(parameter);
  }
  if (operation.requestBody) shape.body = operation.requestBody.required === true
    ? z.record(z.string(), z.unknown())
    : z.record(z.string(), z.unknown()).optional();
  return shape;
}
export function isAllowedOperation(method, route, authContext) {
  const scopes = Array.isArray(authContext?.scopes) ? authContext.scopes : null;
  if (scopes && !scopes.includes("mcp:read")) return false;
  if (method === "get") {
    // Avoid automatically exposing credential, pairing-secret, media, authentication, and broad admin reads.
    if (/^\/(user\/api-key|sessions\/[^/]+\/qr|users(?:\/|$)|settings\/system|auth(?:\/|$)|oauth(?:\/|$)|media(?:\/|$)|messages\/[^/]+\/download\/)/.test(route)) return false;
    if (scopes) {
      const sessionRead = /^\/sessions(?:\/[^/]+)?$/.test(route) && scopes.includes("sessions:read");
      if (!sessionRead && !scopes.includes("api:read")) return false;
    }
    return true;
  }
  if (!writeAllowlist.has(operationKey(method, route))) return false;
  // HTTP API writes also require api:write. mcp:write alone is not a bearer
  // permission for direct API writes, and the MCP server must not bypass that.
  return !scopes || (scopes.includes("mcp:write") && scopes.includes("api:write"));
}
function pathForRoute(route, args) {
  return route.replace(/\{([^}]+)\}/g, (_match, name) => {
    const value = args[name];
    if (value === undefined || value === null || value === "") throw new Error(`Missing required path parameter: ${name}`);
    return encodeURIComponent(String(value));
  });
}
function buildUrl(baseUrl, route, operation, args) {
  const url = new URL(`${baseUrl.toString().replace(/\/$/, "")}${pathForRoute(route, args)}`);
  for (const parameter of operation.parameters ?? []) {
    if (parameter.in !== "query") continue;
    const value = args[parameter.name];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(parameter.name, String(item));
    else url.searchParams.set(parameter.name, String(value));
  }
  return url;
}
async function callApi(method, route, operation, args, authContext) {
  const baseUrl = safeBaseUrl();
  const url = buildUrl(baseUrl, route, operation, args);
  const headers = addNgrokSkipWarningHeader({ Accept: "application/json" }, url);
  if (authContext?.accessToken) headers.Authorization = `Bearer ${authContext.accessToken}`;
  else if (apiKey) headers["X-API-Key"] = apiKey;
  let body;
  if (operation.requestBody && args.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(args.body);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: method.toUpperCase(), headers, body, signal: controller.signal, redirect: "error" });
    const contentType = response.headers.get("content-type") ?? "";
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > maxResponseBytes) {
      await response.body?.cancel();
      throw new Error("API response exceeded WA_AKG_MCP_MAX_RESPONSE_BYTES");
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > maxResponseBytes) throw new Error("API response exceeded WA_AKG_MCP_MAX_RESPONSE_BYTES");
    let data = raw;
    if (contentType.includes("json") && raw) { try { data = JSON.parse(raw); } catch { /* keep invalid JSON as text */ } }
    if (!response.ok) {
      const detail = typeof data === "string" ? data.slice(0, 1000) : JSON.stringify(data).slice(0, 1000);
      throw new Error(`WA-AKG API returned HTTP ${response.status}: ${detail}`);
    }
    return { status: response.status, data };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`WA-AKG API request timed out after ${timeoutMs} ms`);
    if (error instanceof TypeError) throw new Error("Could not connect to WA-AKG API; check WA_AKG_API_BASE_URL and whether the API is running");
    throw error;
  } finally { clearTimeout(timeout); }
}
function registerApiTools(spec, targetServer = server, authContext) {
  let registered = 0;
  const usedNames = new Set();
  for (const [route, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!["get", "post", "put", "patch", "delete"].includes(method) || !isAllowedOperation(method, route, authContext)) continue;
      let name = toolName(method, route);
      if (usedNames.has(name)) name = `${name}_${Buffer.from(route).toString("hex").slice(0, 8)}`;
      usedNames.add(name);
      const methodLabel = method.toUpperCase();
      const description = [
        operation.summary ?? `${methodLabel} ${route}`,
        `WA-AKG API operation: ${methodLabel} ${route}.`,
        method === "get" ? "Read operation." : "Write operation explicitly enabled through WA_AKG_MCP_WRITE_ALLOWLIST."
      ].join(" ");
      targetServer.registerTool(name, {
        title: operation.summary ?? name,
        description,
        inputSchema: createInputSchema(operation),
        annotations: { readOnlyHint: method === "get", destructiveHint: method === "delete", idempotentHint: ["get", "put", "delete"].includes(method), openWorldHint: false }
      }, async (args) => {
        try {
          if (!isAllowedOperation(method, route, authContext)) throw new Error("The current OAuth token does not grant this MCP tool");
          const result = await callApi(method, route, operation, args, authContext);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2).slice(0, maxResponseBytes) }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Unknown WA-AKG API error" }] };
        }
      });
      registered += 1;
    }
  }
  return registered;
}
export async function initializeMcpServer(targetServer = server, authContext) {
  if (initializedServers.has(targetServer)) return registeredCounts.get(targetServer) ?? 0;
  const raw = await readFile(specPath, "utf8");
  const spec = JSON.parse(raw);
  if (!spec.openapi || !spec.paths) throw new Error(`Invalid OpenAPI document: ${specPath}`);
  const count = registerApiTools(spec, targetServer, authContext);
  targetServer.registerTool("wa_akg_server_info", {
    title: "WA-AKG MCP server information",
    description: "Returns safe runtime metadata and the configured API target without revealing credentials.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async () => {
    const baseUrl = safeBaseUrl();
    const availableWriteTools = authContext?.scopes
      ? [...writeAllowlist].filter((entry) => {
          const separator = entry.indexOf(" ");
          return separator > 0 && isAllowedOperation(entry.slice(0, separator).toLowerCase(), entry.slice(separator + 1), authContext);
        }).length
      : writeAllowlist.size;
    return { content: [{ type: "text", text: JSON.stringify({
      server: "wa-akg-mcp", version: "0.1.0", openapiVersion: spec.openapi,
      apiTitle: spec.info?.title ?? "WA-AKG API", apiVersion: spec.info?.version ?? "unknown",
      apiBaseUrl: baseUrl.origin + baseUrl.pathname, apiKeyConfigured: Boolean(apiKey),
      authentication: authContext ? "oauth-user-delegation" : (apiKey ? "local-api-key" : "none"),
      writeToolsEnabled: availableWriteTools > 0, writeAllowlistCount: availableWriteTools, registeredApiTools: count
    }, null, 2) }] };
  });
  initializedServers.add(targetServer);
  registeredCounts.set(targetServer, count);
  return count;
}

async function main() {
  await initializeMcpServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // stdout is reserved for MCP protocol messages; diagnostics go to stderr.
    console.error(`wa-akg-mcp startup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
