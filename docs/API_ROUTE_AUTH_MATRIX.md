# API route authentication matrix (static)

Generated from the current route handlers: **95 route files, 125 HTTP methods**. This is a source-level inventory, not runtime test evidence. Guards may be delegated to local helpers; the evidence column records the call site or the reviewed policy for helper-backed/public protocol routes.

Coverage method: each row has static source review evidence. Runtime anonymous checks used `http://127.0.0.1:43000/wa-akg`: earlier sweeps covered 82 protected route paths; a complete method enumeration below exercised 122 of the 125 declared methods and all returned 401 without a `Location` header. Public endpoint samples `GET /api/auth/providers` and `GET /api/auth/session` returned 200; response bodies were not read. Three public authentication methods were excluded from the full-method sweep because they can create accounts or authentication state: `POST /api/auth/register` and `GET`/`POST /api/auth/[...nextauth]`. No request body, cookie, or API key was supplied; response bodies were cancelled. Authenticated success, owner/shared/admin isolation, and handler behavior after authentication remain `NOT_VERIFIED`. Shared session access is intentionally distinct from owner-only management operations; remediations require owner/admin for session settings, lifecycle actions, QR/pairing, bot configuration writes, and webhook mutations/tests.

The heuristic pass found **0 methods with no auth marker or reviewed exception**.

| Route | Method | Authentication / access evidence | Handler line |
|---|---|---|---:|
| `auth/[...nextauth]/route.ts` | `GET` | Public NextAuth protocol handler; Public NextAuth protocol handler | 29 |
| `auth/[...nextauth]/route.ts` | `POST` | Public NextAuth protocol handler; Public NextAuth protocol handler | 30 |
| `auth/register/route.ts` | `POST` | Public registration; bootstrap SUPERADMIN only when user table is empty, later registration configuration-gated; session/role/scope at 17, 46, 47 | 12 |
| `autoreplies/[sessionId]/[replyId]/route.ts` | `DELETE` | guard/helper at 80; session/role/scope at 85 | 73 |
| `autoreplies/[sessionId]/[replyId]/route.ts` | `PUT` | guard/helper at 11; session/role/scope at 16 | 5 |
| `autoreplies/[sessionId]/route.ts` | `GET` | guard/helper at 14; session/role/scope at 19 | 7 |
| `autoreplies/[sessionId]/route.ts` | `POST` | guard/helper at 55; session/role/scope at 78 | 48 |
| `chat/[sessionId]/[jid]/archive/route.ts` | `PUT` | guard/helper at 11; session/role/scope at 25 | 6 |
| `chat/[sessionId]/[jid]/mute/route.ts` | `PUT` | guard/helper at 11; session/role/scope at 27 | 6 |
| `chat/[sessionId]/[jid]/pin/route.ts` | `PUT` | guard/helper at 11; session/role/scope at 27 | 6 |
| `chat/[sessionId]/[jid]/presence/route.ts` | `POST` | guard/helper at 11; session/role/scope at 32 | 7 |
| `chat/[sessionId]/[jid]/profile-picture/route.ts` | `POST` | guard/helper at 12; session/role/scope at 20 | 7 |
| `chat/[sessionId]/[jid]/read/route.ts` | `PUT` | guard/helper at 11; session/role/scope at 21 | 6 |
| `chat/[sessionId]/[jid]/route.ts` | `GET` | guard/helper at 13; session/role/scope at 19 | 5 |
| `chat/[sessionId]/check/route.ts` | `POST` | guard/helper at 11; session/role/scope at 33 | 6 |
| `chat/[sessionId]/route.ts` | `GET` | guard/helper at 13; session/role/scope at 19 | 6 |
| `chats/[sessionId]/by-label/[labelId]/route.ts` | `GET` | guard/helper at 11; session/role/scope at 19 | 6 |
| `contacts/[sessionId]/[jid]/block/route.ts` | `POST` | guard/helper at 11; session/role/scope at 20 | 6 |
| `contacts/[sessionId]/[jid]/unblock/route.ts` | `POST` | guard/helper at 11; session/role/scope at 20 | 6 |
| `contacts/[sessionId]/route.ts` | `GET` | guard/helper at 11; session/role/scope at 25 | 7 |
| `docs/route.ts` | `GET` | guard/helper at 13; Authenticated user or time-limited Swagger auth cookie | 9 |
| `groups/[sessionId]/[jid]/description/route.ts` | `PUT` | guard/helper at 12; session/role/scope at 28 | 7 |
| `groups/[sessionId]/[jid]/ephemeral/route.ts` | `PUT` | guard/helper at 12; session/role/scope at 33 | 7 |
| `groups/[sessionId]/[jid]/invite/route.ts` | `GET` | guard/helper at 12; session/role/scope at 21 | 7 |
| `groups/[sessionId]/[jid]/invite/route.ts` | `PUT` | guard/helper at 57; session/role/scope at 66 | 52 |
| `groups/[sessionId]/[jid]/leave/route.ts` | `POST` | guard/helper at 11; session/role/scope at 20 | 6 |
| `groups/[sessionId]/[jid]/members/route.ts` | `PUT` | guard/helper at 12; session/role/scope at 38 | 7 |
| `groups/[sessionId]/[jid]/picture/route.ts` | `DELETE` | guard/helper at 63; session/role/scope at 72 | 58 |
| `groups/[sessionId]/[jid]/picture/route.ts` | `PUT` | guard/helper at 12; session/role/scope at 27 | 7 |
| `groups/[sessionId]/[jid]/route.ts` | `GET` | guard/helper at 11; session/role/scope at 20 | 6 |
| `groups/[sessionId]/[jid]/settings/route.ts` | `PUT` | guard/helper at 11; session/role/scope at 34 | 6 |
| `groups/[sessionId]/[jid]/subject/route.ts` | `PUT` | guard/helper at 12; session/role/scope at 31 | 7 |
| `groups/[sessionId]/create/route.ts` | `POST` | guard/helper at 12; session/role/scope at 31 | 7 |
| `groups/[sessionId]/invite/accept/route.ts` | `POST` | guard/helper at 12; session/role/scope at 26 | 7 |
| `groups/[sessionId]/route.ts` | `GET` | guard/helper at 11; session/role/scope at 19 | 6 |
| `labels/[sessionId]/[labelId]/route.ts` | `DELETE` | guard/helper at 77; session/role/scope at 96 | 72 |
| `labels/[sessionId]/[labelId]/route.ts` | `PUT` | guard/helper at 13; session/role/scope at 35 | 7 |
| `labels/[sessionId]/chat/[jid]/labels/route.ts` | `GET` | guard/helper at 14; session/role/scope at 24 | 6 |
| `labels/[sessionId]/chat/[jid]/labels/route.ts` | `PUT` | guard/helper at 58; session/role/scope at 75 | 50 |
| `labels/[sessionId]/chats/route.ts` | `GET` | guard/helper at 16; session/role/scope at 21 | 6 |
| `labels/[sessionId]/route.ts` | `GET` | guard/helper at 12; session/role/scope at 22 | 6 |
| `labels/[sessionId]/route.ts` | `POST` | guard/helper at 52; session/role/scope at 65 | 46 |
| `media/[filename]/route.ts` | `GET` | guard/helper at 30; session/role/scope at 45, 46, 50 | 24 |
| `media/route.ts` | `DELETE` | guard/helper at 149; session/role/scope at 175, 181 | 148 |
| `media/route.ts` | `GET` | guard/helper at 29; session/role/scope at 39, 42, 67, 70 | 28 |
| `messages/[sessionId]/[jid]/[messageId]/react/route.ts` | `POST` | guard/helper at 11; session/role/scope at 26 | 6 |
| `messages/[sessionId]/[jid]/[messageId]/reply/route.ts` | `POST` | guard/helper at 16; session/role/scope at 32 | 12 |
| `messages/[sessionId]/[jid]/[messageId]/route.ts` | `DELETE` | guard/helper at 12; session/role/scope at 20 | 7 |
| `messages/[sessionId]/[jid]/[messageId]/route.ts` | `PATCH` | guard/helper at 59; session/role/scope at 72 | 54 |
| `messages/[sessionId]/[jid]/[messageId]/star/route.ts` | `POST` | guard/helper at 14; session/role/scope at 26 | 9 |
| `messages/[sessionId]/[jid]/album/route.ts` | `POST` | guard/helper at 15; session/role/scope at 23 | 10 |
| `messages/[sessionId]/[jid]/contact/route.ts` | `POST` | guard/helper at 12; session/role/scope at 37 | 7 |
| `messages/[sessionId]/[jid]/interactive/route.ts` | `POST` | guard/helper at 15; session/role/scope at 23 | 10 |
| `messages/[sessionId]/[jid]/list/route.ts` | `POST` | guard/helper at 14; session/role/scope at 31 | 7 |
| `messages/[sessionId]/[jid]/location/route.ts` | `POST` | guard/helper at 15; session/role/scope at 37 | 7 |
| `messages/[sessionId]/[jid]/media/route.ts` | `POST` | guard/helper at 11; session/role/scope at 27 | 6 |
| `messages/[sessionId]/[jid]/poll/route.ts` | `POST` | guard/helper at 15; session/role/scope at 37 | 7 |
| `messages/[sessionId]/[jid]/reply/route.ts` | `POST` | guard/helper at 17; session/role/scope at 37 | 13 |
| `messages/[sessionId]/[jid]/send/route.ts` | `POST` | guard/helper at 11; session/role/scope at 27 | 6 |
| `messages/[sessionId]/[jid]/spam/route.ts` | `POST` | guard/helper at 11; session/role/scope at 25 | 6 |
| `messages/[sessionId]/[jid]/sticker/route.ts` | `POST` | guard/helper at 13; session/role/scope at 27 | 8 |
| `messages/[sessionId]/broadcast/history/[logId]/route.ts` | `GET` | guard/helper at 10; session/role/scope at 17 | 5 |
| `messages/[sessionId]/broadcast/history/route.ts` | `GET` | guard/helper at 10; session/role/scope at 17 | 5 |
| `messages/[sessionId]/broadcast/route.ts` | `POST` | guard/helper at 13; session/role/scope at 28 | 8 |
| `messages/[sessionId]/download/[messageId]/media/route.ts` | `GET` | guard/helper at 14; session/role/scope at 20 | 8 |
| `messages/[sessionId]/forward/route.ts` | `POST` | guard/helper at 12; session/role/scope at 30 | 7 |
| `messages/[sessionId]/search/route.ts` | `GET` | guard/helper at 15; session/role/scope at 40 | 11 |
| `notifications/delete/route.ts` | `DELETE` | guard/helper at 6; session/role/scope at 21 | 5 |
| `notifications/read/route.ts` | `PATCH` | guard/helper at 7; session/role/scope at 16, 22 | 6 |
| `notifications/route.ts` | `GET` | guard/helper at 7; session/role/scope at 12 | 6 |
| `notifications/route.ts` | `POST` | guard/helper at 23; session/role/scope at 26, 29 | 22 |
| `oauth/authorize/decision/route.ts` | `POST` | guard/helper at 7; session/role/scope at 24, 26 | 6 |
| `oauth/authorize/route.ts` | `GET` | guard/helper at 39; Signed-in consent; OAuth client, exact redirect and PKCE validated | 14 |
| `oauth/clients/[clientId]/route.ts` | `PATCH` | guard/helper at 13; session/role/scope at 14 | 12 |
| `oauth/clients/route.ts` | `GET` | guard/helper at 22; SUPERADMIN helper (admin(request)) | 21 |
| `oauth/clients/route.ts` | `POST` | guard/helper at 31; SUPERADMIN helper (admin(request)) | 30 |
| `oauth/grants/[clientId]/route.ts` | `DELETE` | guard/helper at 6; Authenticated; query/revoke is bound to current user ID | 5 |
| `oauth/grants/route.ts` | `GET` | guard/helper at 6; Authenticated; query/revoke is bound to current user ID | 5 |
| `oauth/introspect/route.ts` | `POST` | guard/helper at 8; OAuth client credentials; revoke/introspect are client-bound | 5 |
| `oauth/revoke/route.ts` | `POST` | guard/helper at 8, 9; OAuth client credentials; revoke/introspect are client-bound | 5 |
| `oauth/token/route.ts` | `POST` | guard/helper at 13; OAuth client credentials; revoke/introspect are client-bound | 7 |
| `oauth/userinfo/route.ts` | `GET` | guard/helper at 7; session/role/scope at 11 | 5 |
| `profile/[sessionId]/name/route.ts` | `PUT` | guard/helper at 12; session/role/scope at 17 | 6 |
| `profile/[sessionId]/picture/route.ts` | `DELETE` | guard/helper at 53; session/role/scope at 58 | 47 |
| `profile/[sessionId]/picture/route.ts` | `PUT` | guard/helper at 12; session/role/scope at 17 | 6 |
| `profile/[sessionId]/route.ts` | `GET` | guard/helper at 11; session/role/scope at 16 | 5 |
| `profile/[sessionId]/status/route.ts` | `PUT` | guard/helper at 12; session/role/scope at 17 | 6 |
| `scheduler/[sessionId]/[scheduleId]/route.ts` | `DELETE` | guard/helper at 78; session/role/scope at 83 | 71 |
| `scheduler/[sessionId]/[scheduleId]/route.ts` | `PUT` | guard/helper at 12; session/role/scope at 17 | 6 |
| `scheduler/[sessionId]/route.ts` | `GET` | guard/helper at 15; session/role/scope at 20 | 8 |
| `scheduler/[sessionId]/route.ts` | `POST` | guard/helper at 68; session/role/scope at 80 | 61 |
| `sessions/[sessionId]/[action]/route.ts` | `POST` | guard/helper at 12; session/role/scope at 22 | 7 |
| `sessions/[sessionId]/access/route.ts` | `DELETE` | guard/helper at 170; session/role/scope at 177, 178, 204, 217 | 165 |
| `sessions/[sessionId]/access/route.ts` | `GET` | guard/helper at 20; session/role/scope at 27, 28, 45 | 15 |
| `sessions/[sessionId]/access/route.ts` | `POST` | guard/helper at 72; session/role/scope at 79, 80, 120, 121, 122, 126, 140 | 67 |
| `sessions/[sessionId]/bot-config/route.ts` | `GET` | guard/helper at 13; session/role/scope at 18, 23 | 6 |
| `sessions/[sessionId]/bot-config/route.ts` | `POST` | guard/helper at 79; session/role/scope at 82 | 71 |
| `sessions/[sessionId]/qr/route.ts` | `GET` | guard/helper at 14; session/role/scope at 20 | 7 |
| `sessions/[sessionId]/route.ts` | `GET` | guard/helper at 12; session/role/scope at 21, 26 | 7 |
| `sessions/[sessionId]/settings/route.ts` | `DELETE` | guard/helper at 94; session/role/scope at 100 | 87 |
| `sessions/[sessionId]/settings/route.ts` | `GET` | guard/helper at 14; session/role/scope at 19 | 7 |
| `sessions/[sessionId]/settings/route.ts` | `PATCH` | guard/helper at 48; session/role/scope at 54, 59 | 41 |
| `sessions/route.ts` | `GET` | guard/helper at 10; session/role/scope at 16 | 8 |
| `sessions/route.ts` | `POST` | guard/helper at 31; Authenticated; created session is assigned to current user ID | 29 |
| `settings/system/route.ts` | `GET` | guard/helper at 7; Authenticated; reads singleton public application settings | 5 |
| `settings/system/route.ts` | `POST` | guard/helper at 24; session/role/scope at 25 | 22 |
| `swagger-auth/route.ts` | `DELETE` | Public password-gated Swagger authentication endpoint; Public password-gated Swagger authentication endpoint | 85 |
| `swagger-auth/route.ts` | `GET` | Public password-gated Swagger authentication endpoint; Public password-gated Swagger authentication endpoint | 16 |
| `swagger-auth/route.ts` | `POST` | Public password-gated Swagger authentication endpoint; Public password-gated Swagger authentication endpoint | 25 |
| `system/check-updates/route.ts` | `POST` | guard/helper at 15; session/role/scope at 17, 32, 44, 57 | 14 |
| `system/monitor/[sessionId]/route.ts` | `GET` | guard/helper at 17; session/role/scope at 22 | 9 |
| `system/monitor/route.ts` | `GET` | guard/helper at 11; session/role/scope at 16, 17 | 8 |
| `user/api-key/route.ts` | `DELETE` | guard/helper at 47; Authenticated; operation is bound to current user ID | 46 |
| `user/api-key/route.ts` | `GET` | guard/helper at 10; Authenticated; operation is bound to current user ID | 9 |
| `user/api-key/route.ts` | `POST` | guard/helper at 27; Authenticated; operation is bound to current user ID | 26 |
| `users/[id]/route.ts` | `DELETE` | guard/helper at 60; session/role/scope at 62, 63 | 57 |
| `users/[id]/route.ts` | `PATCH` | guard/helper at 10; session/role/scope at 12, 13, 24 | 7 |
| `users/route.ts` | `GET` | guard/helper at 15; session/role/scope at 17, 18 | 15 |
| `users/route.ts` | `POST` | guard/helper at 44; session/role/scope at 46, 47 | 44 |
| `webhooks/[sessionId]/[id]/logs/route.ts` | `GET` | guard/helper at 8; session/role/scope at 18 | 4 |
| `webhooks/[sessionId]/[id]/route.ts` | `DELETE` | guard/helper at 93; session/role/scope at 100 | 89 |
| `webhooks/[sessionId]/[id]/route.ts` | `PUT` | guard/helper at 11; session/role/scope at 18 | 7 |
| `webhooks/[sessionId]/[id]/test/route.ts` | `POST` | guard/helper at 10; session/role/scope at 17 | 6 |
| `webhooks/[sessionId]/route.ts` | `GET` | guard/helper at 10; session/role/scope at 18 | 6 |
| `webhooks/[sessionId]/route.ts` | `POST` | guard/helper at 64; session/role/scope at 71 | 60 |

## Review limitations

- This inventory identifies handler-level guards and manually reviewed exceptions. It does not exercise database-backed owner/share isolation, OAuth token grants, or every request validation branch.
- `GET` handlers that return shared session data were reviewed separately for QR and credential projection; owner/admin responses retain management data.
- Public routes are expected only for registration/bootstrap, NextAuth protocol handling, Swagger password authentication, and OAuth protocol endpoints authenticated by client or bearer credentials.

## Additional runtime evidence (2026-10-24)

The current route tree was enumerated again: 95 route files with 125 declared HTTP methods. The middleware in `src/proxy.ts` handles every `/api/*` request before the route handler and returns 401 when no session or API key is present; only `/api/auth/*` skips that guard. This ordering makes unauthenticated checks safe for guarded mutation routes because their handlers are not invoked. The sweep sent each declared method to local placeholder paths for every route except the three public registration/NextAuth methods listed above. All **122 requests returned 401**, no redirects, and response bodies were cancelled without reading. This is evidence of anonymous middleware rejection only, not authenticated authorization or business behavior.

An independent read-only sweep enumerated the current source tree (95 route files) and exercised every discovered non-protocol `GET` handler against the local service at `127.0.0.1:43000/wa-akg`. All **37 requests returned HTTP 401 with no `Location` header**. Response bodies were cancelled without inspection. Dynamic parameters used inert placeholder values. The sweep excluded NextAuth handlers, `oauth/authorize` (may create authorization state), and `swagger-auth`; this confirms only anonymous rejection behavior for the listed GET handlers, not authenticated success or data-level authorization.

Runtime-checked GET paths:

`/api/autoreplies/probe`, `/api/chat/probe`, `/api/chat/probe/12025550123@s.whatsapp.net`, `/api/chats/probe/by-label/probe`, `/api/contacts/probe`, `/api/docs`, `/api/groups/probe`, `/api/groups/probe/12025550123@s.whatsapp.net/invite`, `/api/groups/probe/12025550123@s.whatsapp.net`, `/api/labels/probe/chat/12025550123@s.whatsapp.net/labels`, `/api/labels/probe/chats`, `/api/labels/probe`, `/api/media`, `/api/media/missing-probe.txt`, `/api/messages/probe/broadcast/history`, `/api/messages/probe/broadcast/history/probe`, `/api/messages/probe/download/probe/media`, `/api/messages/probe/search`, `/api/notifications`, `/api/oauth/clients`, `/api/oauth/grants`, `/api/oauth/userinfo`, `/api/profile/probe`, `/api/scheduler/probe`, `/api/sessions`, `/api/sessions/probe/access`, `/api/sessions/probe/bot-config`, `/api/sessions/probe/qr`, `/api/sessions/probe`, `/api/sessions/probe/settings`, `/api/settings/system`, `/api/system/monitor`, `/api/system/monitor/probe`, `/api/user/api-key`, `/api/users`, `/api/webhooks/probe`, `/api/webhooks/probe/probe/logs`.

The API audit agents' Chrome DevTools context contained only `about:blank`. The coordinator later reused a separate isolated browser context with the user-authorized superadmin session and made four read-only GET probes using inert nonexistent IDs. `/api/sessions/__codex_no_such_session__` and `/api/system/monitor/__codex_no_such_session__` returned 404; `/api/users/__codex_no_such_user__` and `/api/oauth/clients/__codex_no_such_client__` returned 405 because those item routes do not declare GET. Response bodies were fully consumed but never inspected. These results confirm middleware passage for those samples only; authenticated owner/shared/non-owner isolation, valid resource reads, and handler business logic remain `NOT_VERIFIED`.
