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
WA_AKG_MCP_ALLOW_REMOTE_API=false
```

MCP clients discover OAuth metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`. The endpoint uses `Authorization: Bearer <OAuth access token>` and validates it on each MCP request, including an exact resource/audience match for the MCP URL. It forwards that user's token to generated WA-AKG API tools, where API scopes, roles, session ownership and per-session READ/WRITE capabilities are checked again. Static HTTP bearer credentials are not accepted.

Write tools are exposed only when the OAuth grant explicitly gives the selected session `WRITE`. MCP still filters operations to the safe delegated OpenAPI roots/methods, and each write requires both `mcp:write` and `api:write`; WA-AKG rechecks the user's role, ownership, and OAuth session restriction on every API call. Local stdio uses the signed-in user's own API key and is read-only by default; explicit JSON `WA_AKG_MCP_CREDENTIAL_CAPABILITIES` is required for local writes, with no process-wide write allowlist or wildcard. Authentication, API-key, pairing-QR, cookie-only, unscoped aggregate, and global administration routes remain excluded from delegated OAuth tools.

MCP authentication never creates a WhatsApp session implicitly. The user must create and start a session in the dashboard, then select it in the OAuth consent screen. A write-capable MCP grant may call the explicit session-creation tool only when that operation was granted.

Request bodies are limited to 1 MiB. Tool API calls have bounded timeouts and response sizes; redirects are rejected. API targets are loopback-only by default. Remote targets require HTTPS and an explicit `WA_AKG_MCP_ALLOW_REMOTE_API=true` setting. OAuth bearer tokens must never be written to logs.

MCP transport sessions live in process memory, expire after 30 minutes idle and are limited to 500 active sessions per process. After a restart, clients initialize a new transport session. OAuth grants and refresh tokens remain persistent in Prisma.

## Local stdio mode

```powershell
Set-Location C:\repos\WA-AKG
npm run mcp:install
npm run mcp:check
npm run mcp:start
```

For local stdio use, first open **Dashboard -> OAuth Access -> Local MCP setup** while signed in. The first setup creates the API key for that user and reveals it once. Put that value in `WA_AKG_API_KEY` in that user's MCP client environment, together with `WA_AKG_API_BASE_URL`. Re-running setup never reveals an existing key; use the API key rotation control if it was lost. `WA_AKG_API_KEY` is ignored by the HTTP OAuth transport. Do not expose a stdio server directly on a network port.

## Live stdio read-only smoke (opt-in)

The command below **calls the running WA-AKG API** using the user's own credential. It never sends WhatsApp messages and emits only a summary (tool count and session count). Configure `WA_AKG_API_BASE_URL` to the correct local `/api` path and provide `WA_AKG_API_KEY` through a private process environment. Do not embed credentials in tracked TOML or commit `.env` files.

```powershell
npm run mcp:smoke:live-readonly
```

The script forces read-only permissions for its spawned MCP server. Success requires `initialize`, `tools/list`, `wa_akg_server_info` and `wa_akg_get_sessions` with HTTP 200. Authentication may update the backend's last-used timestamp; the script does not modify sessions or send messages.

## Production sessions integration check

The production check makes read-only `GET /sessions` requests using an OAuth access token, matching the delegated authentication path used by HTTP MCP. It requires `WA_AKG_PROD_API_BASE_URL` (the public HTTPS API base ending in `/api`, including any deployment base path) and `WA_AKG_PROD_OAUTH_ACCESS_TOKEN` in the process environment. Set optional `WA_AKG_PROD_REPLICA_API_BASE_URLS` to a comma-separated list of additional public HTTPS API bases when the deployment exposes replica targets through a test proxy. The script validates every target and prints only HTTP results and session counts; it never prints the token or session data.

Run it explicitly with `npm run mcp:test:production-sessions` from the repository root. Use a short-lived token with `api:read` or `sessions:read`; do not put the token in source control or a committed file. The request is not part of the default local test suite and is never run automatically.

See [docs/OAUTH.md](../../docs/OAUTH.md) for OAuth scopes, client setup, endpoints and session restrictions.
