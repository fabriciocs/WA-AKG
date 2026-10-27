# Reverse proxy under `/wa-akg`

WA-AKG can serve the same build at its root and behind a reverse proxy under `/wa-akg`. The application build must not set Next.js `basePath` or `NEXT_PUBLIC_BASE_PATH`.

Configure the proxy in front of port `43000` with this contract:

- Forward `/wa-akg` and `/wa-akg/*` to the WA-AKG server after removing the `/wa-akg` prefix.
- Set `X-Forwarded-Prefix: /wa-akg` on those requests. Preserve the public `Host` header and set `X-Forwarded-Host` and `X-Forwarded-Proto` to the external host and scheme.
- Forward `/_next/*`, `/favicon.ico`, and any other root-relative static asset paths emitted by Next.js to the same WA-AKG server. The build has no fixed asset prefix so the root-mounted instance can use the same assets.
- Forward `/wa-akg/api/socket/io` to `/api/socket/io` with WebSocket upgrade headers and keep-alive support.
- Set `BASE_URL` and `NEXTAUTH_URL` to the public origin used by the deployment (for example the HTTPS ngrok origin). Localhost origins remain accepted for the local URLs.

The proxy must replace client-supplied `X-Forwarded-Prefix`, `X-Forwarded-Host` and `X-Forwarded-Proto` values with trusted values. These headers control generated navigation, API, authentication, media, OAuth and Socket.IO URLs, as well as redirect origins.

The proxy configuration is external to this repository. A successful application build does not verify that the proxy or ngrok tunnel implements this contract.
