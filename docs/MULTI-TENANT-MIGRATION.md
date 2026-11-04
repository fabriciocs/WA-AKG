# Multi-tenant persistence foundation

Status: `IMPLEMENTED` for the additive Prisma schema and offline migration SQL; deployment remains `BLOCKED` pending database reconciliation, backup and operational approval.

## Phase 1 scope

This phase adds the persistence vocabulary for tenant isolation without assigning legacy records to a tenant:

- `Tenant`, `TenantMembership`, `TenantInvitation`, and `TenantSettings` support multiple memberships per user.
- `ResourceGrant` represents explicit per-resource grants inside a tenant.
- `ApiCredential` stores only a credential hash and non-secret prefix; the raw bearer value is not persisted here.
- `AuditEvent` records ordinary tenant activity. `AdminAccessEvent` is separate for privileged SUPERADMIN access and must be written by a separately authorized and audited flow.
- Existing tenant-bound models receive nullable `tenantId` fields, tenant relations, and tenant-first indexes. Existing identifiers, links, unique constraints, and the public WhatsApp `Session.sessionId` remain unchanged.

All legacy tenant foreign keys are nullable by design. A null value means “legacy scope not classified yet”; it is not permission to expose the record globally.

## Migration gate

`IMPLEMENTED`: migration SQL was generated offline as `prisma/migrations/20261103190500_additive_multi_tenancy/migration.sql` (8 CREATE TABLE, 71 ALTER TABLE, no DROP). Database deployment is BLOCKED pending reconciliation and recovery verification. Historical note:  The installed Prisma CLI could not be executed in the managed Windows sandbox: the direct offline command remained pending without output, and the remote process tool required approval that is unavailable in this session. The local integration runner subsequently generated the SQL using Prisma 5.22.0 from the baseline schema to this additive schema, without accessing the database.

Required offline command when a functioning local process runner is available:

```text
prisma migrate diff --from-schema-datamodel <baseline-schema-at-8f44b31> --to-schema-datamodel prisma/schema.prisma --script
```

Review the generated script for additive operations only, save it under a new timestamped directory in `prisma/migrations`, and run `prisma validate --schema prisma/schema.prisma` plus a SQL/diff review before any database operation. Do not use `db push`, `migrate deploy`, `migrate reset`, or a real database connection for this phase.

## Safe rollout sequence

1. Generate and review the offline migration without a `DATABASE_URL` value being read or printed.
2. Apply the migration only in an isolated, backed-up environment after an explicit operational approval.
3. Observe null counts for each tenant-bound table. Do not infer ownership from the current user, session name, WhatsApp JID, or SUPERADMIN role.
4. Build an evidence-backed classification report mapping each legacy record to a tenant, with ambiguous and missing ownership separated from safe assignments.
5. Backfill only reviewed rows in small, resumable batches. Record the source evidence, operator, timestamp, and resulting tenant ID in the audit trail.
6. Quarantine orphan or ambiguous records in an access-controlled reconciliation path. Quarantine must deny ordinary tenant enumeration and must not silently attach records to a default tenant.
7. After all consumers enforce tenant context and the reconciliation report is complete, add stricter constraints in a later phase. This phase must not make `tenantId` non-null.

## Local schema reconciliation

On 2026-11-03, the configured loopback MySQL database had 6 users, 3 sessions and 11,548 messages. The journal marked `20261031000000_inbound_event_receipts` finished, but `ProcessingResult` and the result foreign key were missing. The existing `InboundEvent.resultId` column had zero non-null values. The inventory now uses the public `Session.sessionId` for `AuthState`. All 14,435 local auth-state rows matched that key.

The on-disk checksums for the baseline, OAuth and worker leases, and inbound receipt migrations differ from the local journal. Preserve those files and journal rows while tracing the original applied versions. A fresh replay of the current history also fails at `20261031100000_add_inbound_event_message_id` because the preceding file already creates `messageId`. In an empty disposable database, inspect the failed step and verify all three effects before marking it applied through Prisma:

- `InboundEvent.messageId` is nullable `VARCHAR(191)`.
- `inbound_event_message_idx` indexes only `InboundEvent.messageId`.
- `InboundEvent_messageId_fkey` references `Message.id` with `ON DELETE SET NULL ON UPDATE CASCADE`.

```text
prisma migrate resolve --applied 20261031100000_add_inbound_event_message_id --schema prisma/schema.prisma
prisma migrate deploy --schema prisma/schema.prisma
```

For a copy of the local database, check the proposed repair first. The repair recreates the missing table from the canonical receipt DDL and checks or restores three foreign keys. If the missing table has referenced results, recover the result rows from backup before proceeding. An empty reference column alone cannot establish whether historical rows were lost.

```text
node --env-file=.env scripts/tenant-reconcile-processing-result.mjs
node --env-file=.env scripts/tenant-reconcile-processing-result.mjs --apply=<exact-copy-database>
```

Use an isolated copy in `DATABASE_URL` for the apply command. The script requires a loopback MySQL address and the exact target database. MySQL DDL commits independently. Keep the copy quiescent, verify that backup and restore work, and re-run the read-only plan after applying the repair. Approve any application to the original database separately after investigating the checksum discrepancies and potential loss.

## Legacy ownership backfill

After the additive migration, the planner reports assignment counts and a fingerprint without returning user IDs or resource identifiers. For each user who predates the additive migration, the personal tenant has the same ID and slug `personal-${sha256(userId).slice(0,32)}` and an active owner membership. It rejects collisions, unexpected owners and inactive personal workspaces. Session-backed rows follow their declared internal or public session reference. Multiple references must agree before assignment.

```text
node --env-file=.env scripts/tenant-backfill.mjs
node --env-file=.env scripts/tenant-backfill.mjs --apply=<exact-copy-database> --expect=<plan-fingerprint> --operator=<operator-id>
```

Run the apply command with writers stopped and a fresh reviewed plan. It recomputes the fingerprint in a serializable transaction and commits the eligible assignments and audit events together. The same input can be planned again to check for pending changes. Unresolved ownership, legacy shares to other users and unbound OAuth credentials remain untouched and are counted in the plan. Full quarantine depends on the runtime denying unscoped records, and legacy OAuth requires re-consent or a separately verified credential transition.

## Current limitations and security boundaries

- Nullable tenant FKs are not hard isolation. Every read/write path must continue to authorize the tenant explicitly; a non-null `tenantId` alone is not an authorization decision.
- Cross-tenant consistency between related legacy rows is not enforced while the fields remain nullable. In particular, session, message, webhook, label, OAuth, broadcast, and lease rows may require coordinated backfill.
- SUPERADMIN global access is not granted by these models. It requires a separate privileged flow, reason, request correlation, outcome, and `AdminAccessEvent` record.
- The additive schema preserves existing records and relationships. Run the backfill as a separate reviewed operation.
- The existing database was inspected with read-only aggregate and metadata queries. Reconciliation and backfill on the existing database remain blocked pending reviewed recovery and rollout.
