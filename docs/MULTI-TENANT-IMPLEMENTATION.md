# ConectaFlow / WA-AKG — Multi-tenant implementation gates

Status: **PARTIAL — implementation in progress**. Source contract: multi-tenant specification v1.0 supplied for this feature. This document is an implementation ledger; proposed APIs below are not automatically live.

## Non-negotiable security boundaries

1. An authenticated identity is not tenant authorization. Each private operation requires an authenticated user/service, one active tenant, active membership (or separately authorized and audited platform administration), the resource's matching tenant, resource ownership/explicit grant and adequate credential scopes.
2. Private resources remain private to their owner even from other users with roles ADMIN or OWNER in the same tenant, unless expressly shared. Platform SUPERADMIN uses a distinct elevated, MFA-verified, reason-bearing and audited access path; SUPERADMIN must never silently cause bearer tokens, API keys, workers or MCP to gain global privileges.
3. Legacy session sharing is not an automatic tenant grant. Grant migrations require owner and resource verification; ambiguous records are quarantined, not assigned.
4. SQL queries, nested includes, writes, workers, OAuth refresh, MCP session resume, Socket.IO room joins, media access and cache/idempotency identifiers must all apply the same server-side boundary. The frontend may suggest a tenant identifier but cannot grant authority.
5. Historical records must remain intact. Additive columns start nullable, are reconciled against owners and sessions, then constrained after validation. Do not run migrations on production or delete old media as part of this feature.

## Delivery phases and objective evidence

| Phase | Gate | Acceptance evidence |
|---|---|---|
| 0 — Inventory | Existing users, sessions, relationships, legacy access grants, credentials, media and orphan records counted; Git clean baseline preserved | Read-only DB report, tested preservation, anomaly list |
| 1 — Additive persistence | Tenant, membership, invitation, setting, grant, tenant key, audit models; nullable tenant IDs in dependent records | Offline migration SQL, Prisma validate and type generation, additive schema review |
| 2 — Backfill | Personal tenant for every identity, session ownership translated, dependent entities assigned; ambiguous data quarantined | Transactional report, no orphan/cross-tenant links, tested rollback/restore plan |
| 3 — Policy enforcement | Centralized tenant context and deny-by-default policy on all API and UI operations | Negative tests A/B and owner-vs-member on every route, no unscoped Prisma operation |
| 4 — Credentials, MCP and workers | API keys, OAuth request/code/access/refresh/grant/session capability, MCP HTTP/stdio and background jobs tenant-bound | Replay/resume/revoke/rotation tests; OAuth PKCE S256, CIMD, DCR unchanged |
| 5 — UX and global admin | Tenant selector, membership/invitation management, privileged dashboard and audit console | Role and capability matrix, MFA and admin access-log tests |
| 6 — Schema hardening | Non-null fields, tenant-first indexes, composite FKs and removal of unsafe fallbacks | Data validation, migration dry run, constraints verified |
| 7 — Final activation | Full regression, integration, media and recovery verification | Signed rollout gate and measured isolation across two real tenants |

**Current release gate:** do not advertise platform-wide isolation, enable tenant enforcement across legacy routes, or apply data migrations until all dependent services are updated and Phase 2 has passed. A partial schema or tenant management API alone does not isolate WhatsApp messages, OAuth tokens or MCP tools.

## Proposed tenancy contracts

- Normal identity: global User, tenant-specific TenantMembership with OWNER/ADMIN/MEMBER/VIEWER and explicit ACTIVE status.
- Operations: one tenant per request; cross-tenant references are rejected before writing. Resource-level PRIVATE, TENANT_SHARED, EXPLICIT_GRANT; capabilities READ, WRITE, MANAGE, DELETE.
- Administrative identity: SUPERADMIN in global administrative context, MFA and a reason for privileged operations; record actor, tenant, action, resource, request ID and outcome. STAFF is legacy and carries no implicit global rights.
- Tenant selection: untrusted x-tenant-id / route selector must be revalidated server-side. Do not accept a client-chosen tenant to widen API key or OAuth grant audience.
- API key: per-tenant hash, scopes, owner and expiry; legacy per-user key cannot be silently elevated.
- OAuth/MCP: tenant and authorized session set immutable throughout authorization, token exchange, refresh and transport resume; new tenant requires a new grant.
- Storage/events: tenant-aware media metadata, protected downloads, per-tenant Socket.IO rooms, webhook jobs, idempotency and retries.

## Proposed HTTP routes (not all are implemented)

- GET/POST `/api/tenants`
- GET `/api/tenants/current`
- GET `/api/tenants/current/members`
- `/api/tenants/current/invitations`
- `/api/admin/tenants`, `/api/admin/tenants/{tenantId}`, `/api/admin/audit`

Routes must describe authentication, scopes, 401/403/404/409 errors and tenant selection in OpenAPI before being marked VERIFIED. Ordinary admin APIs must not be confused with privileged platform administration.

## Mandatory negative tests

- Tenant A user, API key, OAuth token, MCP session, worker and Socket.IO subscriber cannot read/write resources of tenant B.
- Member A cannot read private resources of member B in the *same* tenant without an active exact grant.
- Expired grants, revoked memberships, altered tenant headers, invalid or swapped refresh tokens fail closed.
- Reads with nested relations, raw SQL and updates/deletes in batch cannot cross boundaries.
- SUPERADMIN ordinary bearer credentials are still tenant-bound; privileged access requires MFA, context and audit.
- Media download, cache, scheduled sends, webhook delivery, archived tenant and idempotency replay do not cross tenants.
- Recovery and rollback preserve historical data, WhatsApp session identifiers and credentials without exposing them.

## Operational safeguards

- Windows PowerShell 5.1 for operational scripts; no Playwright.
- MySQL local runs on port 3306 and has pre-existing data; migrations require a verified backup/restore path and explicit deployment gate.
- Generated files in .remote-desktop and packaged zip archives remain local, outside Git publication. Never commit .env contents.
- Preserve Prisma 5 and the repository's npm workflow unless separately justified.
- Mark each gate only from reproducible tests and logs. Any missing service or scope must be BLOCKED or NOT_VERIFIED.

## Verified local discovery — 2026-11-03

- Before feature implementation: 181 application tests passed; TypeScript, lint and Prisma validation passed; MCP check and MCP tests passed.
- MySQL at 127.0.0.1:3306 is reachable. Prisma migrate status reports 12 applied migrations.
- Read-only inventory: 5 users, 3 sessions and 11,548 messages; 1 legacy SessionAccess grant to a non-owner. Do not convert this grant implicitly.
- Schema drift: the database lacks the ProcessingResult table despite the Prisma migration status being up-to-date. Inventory status PARTIAL, with query issue P2021.
- Do not execute additive migrations or mandatory constraints on this database until the drift is reconciled and a tested recovery path is available.
- Evidence root: `.remote-desktop/sessions/20261103-multitenant/evidence/` (local and ignored by Git); generated reports do not contain credential values.

## Integrated feature verification — 2026-11-03

- **TESTED:** `prisma validate` and `prisma generate`, TypeScript `tsc --noEmit`, project ESLint, application tests (**213 passed / 0 failed**), MCP syntax check and MCP tests. Verified by local `scripts/Verify-MultiTenantLocal.ps1` execution with zero failed checks.
- **IMPLEMENTED:** additive schema and SQL generated offline (8 new tables, 71 ALTER TABLE statements, no DROP), tenant decision policy with negative authorization tests, limited authenticated tenant-management routes and read-only historical inventory.
- **BLOCKED:** migration application or any tenant backfill against the current MySQL database. The live schema lacks `ProcessingResult` while Prisma reports migrations up-to-date; its consistency, reliable backup and restoration must be verified before changing it.
- **DEFERRED:** connecting the shared policy to all existing WhatsApp routes, API-key/OAuth grants, MCP session resume, WebSocket rooms, media access, webhooks and workers; global SUPERADMIN MFA + durable audit; onboarding, admin UI, tenant sharing and OpenAPI. Existing routes are **not yet protected by this new policy**.
- **NOT VERIFIED:** live HTTP execution of the new endpoints, multi-tenant WhatsApp runtime and legacy data migration. No deployment, SQL execution or credential rotation occurred.
- Log and results: `.remote-desktop/sessions/tenant-validation-20261103-162055/` (ignored by Git).
