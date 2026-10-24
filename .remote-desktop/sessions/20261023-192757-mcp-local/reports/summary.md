# Local WA-AKG MCP validation

**Status: PARTIAL** — WA-AKG is running locally without Docker, and the HTTP MCP endpoint passed protocol and security smoke checks. Database-backed API calls remain blocked by local database connectivity/credentials and missing `WA_AKG_API_KEY`.

## Runtime
- App: `http://127.0.0.1:43000/` — HTTP 200
- MCP: `http://127.0.0.1:43000/mcp`
- Process PID: 93176
- Docker: not used
- MCP feature: enabled via existing local `.env`; token value not included in this report
- Telemetry heartbeat: disabled for this launched process

## Validation results
- Unauthenticated MCP request rejected with HTTP 401.
- MCP initialize succeeded with HTTP 200 and created a session.
- `notifications/initialized` accepted with HTTP 202.
- `tools/list` succeeded and returned 24 tools.
- `wa_akg_server_info` tool call succeeded.
- Write tools remained disabled by default.
- Automated MCP suite: 5 passed, 0 failed.
- WA-AKG homepage returned HTTP 200.

## Blockers
- `.env` points to MySQL at `127.0.0.1:3307`, but that port is not reachable.
- Local MySQL accepts connections on port 3306, but the configured database credentials were rejected there. No database settings were changed.
- `WA_AKG_API_KEY` is not configured. A real read tool call reached the WA-AKG API but received HTTP 401 Unauthorized.
- Scheduler and session initialization log database connection errors. The app server and MCP endpoint are listening, but database-backed API operations are not verified.

## Safety / change control
- No Docker used.
- No secrets included in this report.
- No `.env` values changed.
- No commit, push, merge, or deployment performed.

See `evidence/validation.json` and `raw/execution.log` for session evidence.
