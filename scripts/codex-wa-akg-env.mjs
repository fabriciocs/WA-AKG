import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectRoot);

// Local stdio MCP should call only this machine's WA-AKG instance. The API key,
// if configured in the project environment, stays in this child process and is
// never copied into Codex's global config or printed to stdout/stderr.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/^\/+|\/+$/g, "");
const port = process.env.PORT || "3030";
process.env.WA_AKG_API_BASE_URL = `http://127.0.0.1:${port}${basePath ? `/${basePath}` : ""}/api`;
process.env.WA_AKG_MCP_ALLOW_REMOTE_API = "false";
process.env.WA_AKG_MCP_WRITE_ALLOWLIST = "";
