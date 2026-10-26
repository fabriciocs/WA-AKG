/** Remove URL data that must not be exposed through shared-session views or logs. */
export function sanitizeWebhookUrl(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.username = "";
        parsed.password = "";
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
    } catch {
        // Old rows may predate URL validation; still remove any query or fragment.
        return url.split(/[?#]/, 1)[0];
    }
}

/** Remove the per-request HMAC from new and legacy webhook log headers. */
export function sanitizeWebhookRequestHeaders(headers: unknown): unknown {
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) return headers;

    return Object.fromEntries(
        Object.entries(headers).filter(([name]) => name.trim().toLowerCase() !== "x-webhook-signature"),
    );
}

/** Defense-in-depth serializer for persisted and historical webhook log rows. */
export function sanitizeWebhookLog<T extends object>(log: T): T {
    const safeLog: Record<string, unknown> = { ...(log as unknown as Record<string, unknown>) };
    if (typeof safeLog.requestUrl === "string") {
        safeLog.requestUrl = sanitizeWebhookUrl(safeLog.requestUrl);
    }
    if ("requestHeaders" in safeLog) {
        safeLog.requestHeaders = sanitizeWebhookRequestHeaders(safeLog.requestHeaders);
    }
    return safeLog as T;
}
