# WA-AKG MCP add-on

Optional Model Context Protocol endpoint mounted in the WA-AKG custom HTTP server. It is disabled by default. The package also supports a local stdio MCP server.

## HTTP MCP with OAuth

Create a public OAuth client from **Dashboard → OAuth Access** using the exact redirect URI required by your MCP client. Allow `mcp:read` and, when needed, `mcp:write`. The user approves each connection and may restrict it to selected WhatsApp sessions.

Configure the WA-AKG server process:

```dotenv
OAUTH_ISSUER_URL=https://wa-akg.example.com
WA_AKG_MCP_ENABLED=true
WA_AKG_MCP_HTTP_PATH=/mcp
WA_AKG_API_BASE_URL=http://127.0.0.1:3030/api
WA_AKG_MCP_WRITE_ALLOWLIST=
WA_AKG_MCP_ALLOW_REMOTE_API=false
```

MCP clients discover OAuth metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`. The endpoint uses `Authorization: Bearer <OAuth access token>` and validates it on each MCP request. It forwards that user's token to generated WA-AKG API tools, where API scopes, roles, session ownership and shared `SessionAccess` are checked again. The old static `WA_AKG_MCP_HTTP_TOKEN` is not used.

Write tools remain disabled unless an exact `METHOD /path` entry appears in `WA_AKG_MCP_WRITE_ALLOWLIST`. Keep destructive operations, broadcasts, credential changes and user administration disabled for routine agent use. Even an enabled write tool needs the user's `mcp:write` grant and the required WA-AKG role and session permissions.

Request bodies are limited to 1 MiB. Tool API calls have bounded timeouts and response sizes; redirects are rejected. API targets are loopback-only by default. Remote targets require HTTPS and an explicit `WA_AKG_MCP_ALLOW_REMOTE_API=true` setting. OAuth bearer tokens must never be written to logs.

MCP transport sessions live in process memory, expire after 30 minutes idle and are limited to 500 active sessions per process. After a restart, clients initialize a new transport session. OAuth grants and refresh tokens remain persistent in Prisma.

## Local stdio mode

```powershell
Set-Location C:\repos\WA-AKG
npm run mcp:install
npm run mcp:check
npm run mcp:start
```

For local stdio use, set `WA_AKG_API_BASE_URL` and optionally `WA_AKG_API_KEY` in the MCP client's environment. `WA_AKG_API_KEY` is ignored by the HTTP OAuth transport. Do not expose a stdio server directly on a network port.

See [docs/OAUTH.md](../../docs/OAUTH.md) for OAuth scopes, client setup, endpoints and session restrictions.
