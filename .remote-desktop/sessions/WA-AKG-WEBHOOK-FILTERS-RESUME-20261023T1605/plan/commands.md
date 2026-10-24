# Resume plan — webhook filters

## Goal
Continue the outstanding gates for the local WA-AKG webhook filter implementation, preserving the existing index and all unrelated processes.

## CMD-001 — Reconfirm Git baseline
Risk: READ_ONLY. Verify branch, HEAD, staged hash, staged paths, unstaged and untracked inventory. Success: same HEAD/hash/counts as evidence/git-before.json.

## CMD-002 — Recheck system capacity
Risk: READ_ONLY. Check available physical memory and active Node/Codex processes. Do not terminate any process belonging to another project.

## CMD-003 — Run local production build
Risk: LOW_RISK_WRITE (build artifacts). Run `npm run build` only after sufficient memory is confirmed. Redirect stdout/stderr and exit code to this session's raw directory. Do not change environment files, approve install scripts, or mutate database.

## CMD-004 — Retry Codex orchestration
Risk: LOW_RISK_WRITE (session logs). Run `codex exec --skip-git-repo-check --json --profile auto-best-coding --enable multi_agent` with a bounded prompt to perform parallel read-only audits of webhook filters, UI, tests and docs. Do not ask agents to stage/commit/push or alter unrelated files. If connectivity fails, capture output and mark BLOCKED; do not repeatedly restart OmniRoute or terminate other processes.

## CMD-005 — Revalidate
Run targeted tests, TypeScript, targeted ESLint, JSON validation and `git diff --check` as applicable. Recompute staged hash and path inventory; stop if either changed unexpectedly. Do not stage/commit/push/deploy or mutate database.

## Authorization
No destructive or external side effects are planned. Build artifacts and this session's logs are local. Existing source edits are preserved; only task-related corrections may be made after review.