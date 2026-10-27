# WA-AKG behind Caddy at /wa-akg

## Local routing

- Public local URL: http://localhost:8080/wa-akg/
- Caddy upstream: http://127.0.0.1:43000
- Next.js runs with no configured `basePath`. Caddy must remove `/wa-akg` before proxying and set `X-Forwarded-Prefix: /wa-akg`.
- Preserve the external host and set `X-Forwarded-Host` and `X-Forwarded-Proto`; overwrite any client-supplied forwarded headers.
- Forward root asset requests such as `/_next/*` and `/favicon.ico` to WA-AKG as well as `/wa-akg/*` requests.
- Forward `/wa-akg/api/socket/io` to `/api/socket/io` with WebSocket upgrades enabled.
- Browser navigation, API, Socket.IO, authentication, media, OAuth and MCP URLs derive their prefix at runtime from `X-Forwarded-Prefix`.
- `BASE_URL` and `NEXTAUTH_URL` should identify the public origin for origin checks and canonical URLs. `http://localhost:8080` is accepted for this local Caddy route.

## Validation

1. Keep WA-AKG listening on loopback port 43000.
2. Run Caddy adapt against C:\ProgramData\CaddyWebGateway\Caddyfile; caddy validate may need permission to open the configured access log.
3. Reload Caddy using its local admin endpoint or the installed service workflow.
4. Restart WA-AKG after changing `.env`; no rebuild is needed to change the runtime prefix.
5. Check `/wa-akg/`, root `/_next/static/` assets, `/wa-akg/api/auth/session`, and the Socket.IO polling and WebSocket handshakes. HTML success alone does not prove authenticated flows.

Local-only configuration. No Git commit, push, deployment, or database migration is performed.

## Historical verification

The following observations were made against the earlier build-time `basePath` implementation. They are retained as historical context and do not verify the runtime-prefix implementation above.

- Caddy reload: exit code 0; health endpoint: HTTP 200.
- Verified HTTP 200: /wa-akg/auth/login, /wa-akg/_next/static/css/app/layout.css, /wa-akg/api/auth/session, /wa-akg/api/auth/providers, /wa-akg/api/auth/csrf, and the Socket.IO polling handshake at /wa-akg/api/socket/io.
- HAR follow-up identified the active Next.js 16 request handler as `src/proxy.ts`; redirects previously generated root-level `/dashboard` and `/auth/login` URLs despite the app basePath.
- Verified unauthenticated GET /wa-akg/dashboard returns HTTP 307 with Location: /wa-akg/auth/login?callbackUrl=%2Fwa-akg%2Fdashboard; GET /wa-akg/auth/login returns HTTP 200.
- TypeScript check: tsc --noEmit exit code 0 after the proxy redirect fix.
- The Caddy root URL `/` previously reached its default response (HTTP 200, body `WebGateway Caddy OK`). This does not describe direct access to the WA-AKG server at `http://localhost:43000/`.
- ESLint was deferred: full-repository and targeted runs exceeded the time budget and were stopped; no application process was stopped for this.
- Credential-based login and a production build were not run. The authenticated login-to-dashboard redirect remains NOT_VERIFIED because no authenticated browser session was used in this check.
