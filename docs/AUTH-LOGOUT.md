# Dashboard sign-out behavior

## Issue and evidence (2026-11-01)

When the dashboard is accessed through `http://localhost:43000`, Auth.js is
configured with a public `NEXTAUTH_URL` and `BASE_URL` on an HTTPS ngrok
domain. The Auth.js sign-out endpoint returned HTTP 200 but supplied a
redirect to the public domain root instead of the requested local login path.
This was reproduced with an isolated anonymous CSRF/sign-out request, not an
authenticated browser session.

## Client-side handling

Desktop (expanded and collapsed sidebar) and mobile sign-out use the shared
`src/components/dashboard/sign-out.ts` helper:

1. POST the sign-out request through Auth.js using `redirect: false`.
2. Require an Auth.js success redirect URL in the response.
3. Navigate to the same-origin login path, `/auth/login`, respecting the
   runtime reverse-proxy prefix (for example `/wa-akg/auth/login`).
4. On an unsuccessful request, preserve the current page and display an error.

The server still owns session invalidation and CSRF protection; the client
does not attempt to delete authentication cookies manually. Do not follow a
redirect URL from a different host returned by the server.

## Verification

- `npx tsx --test src/lib/__tests__/dashboard-sign-out.test.ts src/lib/__tests__/base-path.test.ts`
- `npx eslint src/components/dashboard/sign-out.ts src/components/dashboard/sidebar-shell.tsx src/components/dashboard/mobile-nav.tsx src/lib/__tests__/dashboard-sign-out.test.ts`
- `npx tsc --noEmit --incremental false`
- With a test account after deploying/restarting the application, check that
  sign-out from both desktop and mobile reaches the same-origin login page,
  `/api/auth/session` no longer contains the user, and visiting `/dashboard`
  unauthenticated redirects to login. Repeat using the proxy prefix.

## Operational scope

Only local application source files were changed. No runtime process was
restarted, no credentials were changed and no data were deleted. The existing
`NEXTAUTH_URL` setting still determines Auth.js's other redirects; supporting
both local and public origins for all authentication flows requires a separate
configuration audit. This fix specifically prevents a remote redirect from
hijacking the dashboard sign-out navigation.
