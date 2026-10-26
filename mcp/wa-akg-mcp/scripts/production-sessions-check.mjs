const apiBaseUrl = process.env.WA_AKG_PROD_API_BASE_URL;
const accessToken = process.env.WA_AKG_PROD_OAUTH_ACCESS_TOKEN;

function fail(message, exitCode = 1) {
  console.error(`Production sessions check failed: ${message}`);
  process.exitCode = exitCode;
}

if (!apiBaseUrl || !accessToken) {
  fail("set WA_AKG_PROD_API_BASE_URL and WA_AKG_PROD_OAUTH_ACCESS_TOKEN in the process environment", 2);
} else {
  let base;
  try {
    base = new URL(apiBaseUrl);
  } catch {
    fail("WA_AKG_PROD_API_BASE_URL must be an absolute HTTPS URL");
  }

  if (base) {
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(base.hostname.toLowerCase());
    if (base.protocol !== "https:" || loopback || base.username || base.password || base.search || base.hash) {
      fail("the API base URL must be a public HTTPS URL without credentials, query, or fragment");
    } else if (!base.pathname.replace(/\/+$/, "").endsWith("/api")) {
      fail("the API base URL must end in /api (including any deployment base path)");
    } else if (/\s/.test(accessToken)) {
      fail("WA_AKG_PROD_OAUTH_ACCESS_TOKEN must contain only the token value");
    } else {
      base.pathname = base.pathname.replace(/\/+$/, "");
      const sessionsUrl = new URL(`${base.toString()}/sessions`);
      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Cache-Control": "no-store",
      };
      if (sessionsUrl.hostname.endsWith(".ngrok-free.dev")) {
        headers["ngrok-skip-browser-warning"] = "true";
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(sessionsUrl, {
          method: "GET",
          headers,
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });

        let payload;
        try {
          payload = await response.json();
        } catch {
          fail(`GET /sessions returned HTTP ${response.status} with a non-JSON response`);
        }

        if (process.exitCode !== 1) {
          if (!response.ok) {
            fail(`GET /sessions returned HTTP ${response.status}; response body omitted`);
          } else if (payload?.status !== true || !Array.isArray(payload?.data)) {
            fail("GET /sessions returned an unexpected response shape; session data omitted");
          } else {
            console.log(`Production sessions check passed: GET /sessions returned HTTP ${response.status}; ${payload.data.length} session(s).`);
          }
        }
      } catch (error) {
        if (process.exitCode !== 1) {
          fail(error?.name === "AbortError" ? "GET /sessions timed out after 15 seconds" : "GET /sessions could not be completed; URL, TLS, or network error");
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}
