# WA-AKG MCP add-on

Optional Model Context Protocol (MCP) endpoint mounted directly in the WA-AKG custom HTTP server. It does not require Docker and is disabled by default. The add-on can also run as a standalone stdio MCP server for local MCP clients.

## HTTP endpoint (recommended for WA-AKG)

The HTTP endpoint is served by the same WA-AKG process and port as the app, at `http://127.0.0.1:3030/mcp` by default. It uses MCP Streamable HTTP transport with per-client MCP sessions.

Configure these environment variables for the WA-AKG server process before starting it:

```dotenv
WA_AKG_MCP_ENABLED=true
WA_AKG_MCP_HTTP_PATH=/mcp
WA_AKG_MCP_HTTP_TOKEN=replace-with-a-random-secret-at-least-32-characters-long
WA_AKG_API_BASE_URL=http://127.0.0.1:3030/api
WA_AKG_API_KEY=
WA_AKG_MCP_WRITE_ALLOWLIST=
WA_AKG_MCP_ALLOW_REMOTE_API=false
```

Generate a strong token locally, for example in PowerShell:

```powershell
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes)
$token
```

Store the token in the local environment/secret manager, not in source control. Clients must send `Authorization: Bearer <token>`. When the feature is enabled, the server refuses to start the MCP integration if the token is missing or shorter than 32 characters. Requests without a valid token receive HTTP 401. Request bodies are limited to 1 MiB. The endpoint path can be customized with `WA_AKG_MCP_HTTP_PATH`.

The default endpoint is `/mcp`, not `/api/mcp`. It is mounted by `src/server/index.ts` on the same HTTP server that serves WA-AKG. Existing routes are forwarded unchanged. When `WA_AKG_MCP_ENABLED` is not exactly `true`, no MCP endpoint is mounted.

## Tools and safety

Tools are generated from the repository's `swagger.json`. Read operations are exposed except for selected sensitive routes. Write tools are disabled unless an exact `METHOD /path` entry is present in `WA_AKG_MCP_WRITE_ALLOWLIST`. Do not enable delete, broadcast, credential-management, or user-administration operations for routine agent use. The WA-AKG API remains responsible for its own authorization; the MCP bearer token is an additional gate, not a replacement for API authorization.

The API target is loopback-only by default. Redirects are rejected, timeouts and response sizes are bounded, and API keys are not included in tool metadata. Confirm the OpenAPI paths and API authentication mechanism before enabling API tools in a shared environment.

## Standalone stdio mode (optional)

```powershell
Set-Location C:\repos\WA-AKG
npm run mcp:install
npm run mcp:check
npm run mcp:test
npm run mcp:start
```

The stdio server is separate from the app's HTTP endpoint. Do not expose a stdio server directly on a network port.

## Verification and limitations

The local tests validate protocol startup, tool listing, the default read-only policy, and HTTP transport behavior. Live tool calls against a running WA-AKG API still require validation with the correct local API base URL and authentication. This integration should not be treated as production-verified until that test is completed.
