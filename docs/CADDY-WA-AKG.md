# WA-AKG behind Caddy at /wa-akg

## Local routing

- Public local URL: http://localhost:8080/wa-akg/
- Caddy upstream: http://127.0.0.1:43000
- Next.js basePath: /wa-akg, controlled by NEXT_PUBLIC_BASE_PATH and applied at startup/build time.
- Browser API calls, Socket.IO, NextAuth SessionProvider, media URLs, and the optional MCP endpoint use the path prefix.
- BASE_URL remains the origin http://localhost:8080 for origin checks. NEXTAUTH_URL matches Auth.js's internal /api/auth route after Next.js strips its basePath; browser requests and SessionProvider use /wa-akg/api/auth. Public app/API URLs include the path prefix.

## Validation

1. Keep WA-AKG listening on loopback port 43000.
2. Run Caddy adapt against C:\ProgramData\CaddyWebGateway\Caddyfile; caddy validate may need permission to open the configured access log.
3. Reload Caddy using its local admin endpoint or the installed service workflow.
4. Restart WA-AKG after changing .env or next.config.ts; basePath is applied at startup/build time.
5. Check /wa-akg/, /wa-akg/_next/static/, /wa-akg/api/auth/session, and Socket.IO. HTML success alone does not prove authenticated flows.

Local-only configuration. No Git commit, push, deployment, or database migration is performed.

## Current verification

- Caddy reload: exit code 0; health endpoint: HTTP 200.
- Verified HTTP 200: /wa-akg/auth/login, /wa-akg/_next/static/css/app/layout.css, /wa-akg/api/auth/session, /wa-akg/api/auth/providers, /wa-akg/api/auth/csrf, and the Socket.IO polling handshake at /wa-akg/api/socket/io.
- HAR follow-up identified the active Next.js 16 request handler as src/proxy.ts; its redirects previously generated root-level /dashboard and /auth/login URLs despite the app basePath.
- src/proxy.ts now prefixes dashboard/login redirects and callbackUrl values using the parsed Next.js basePath, falling back to NEXT_PUBLIC_BASE_PATH.
- Verified unauthenticated GET /wa-akg/dashboard returns HTTP 307 with Location: /wa-akg/auth/login?callbackUrl=%2Fwa-akg%2Fdashboard; GET /wa-akg/auth/login returns HTTP 200.
- TypeScript check: tsc --noEmit exit code 0 after the proxy redirect fix.
- The root URL /dashboard still reaches Caddy's default response (HTTP 200, body 'WebGateway Caddy OK'); it is not the application route and should not be used. The supported dashboard path is /wa-akg/dashboard.
- ESLint was deferred: full-repository and targeted runs exceeded the time budget and were stopped; no application process was stopped for this.
- Credential-based login and a production build were not run. The authenticated login-to-dashboard redirect remains NOT_VERIFIED because no authenticated browser session was used in this check.