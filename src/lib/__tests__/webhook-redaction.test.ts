import assert from "node:assert/strict";
import test from "node:test";
import {
    sanitizeWebhookLog,
    sanitizeWebhookRequestHeaders,
    sanitizeWebhookUrl,
} from "../webhook-redaction";

test("new webhook log payloads drop HMAC signatures and redact the complete URL query", () => {
    const originalUrl = "https://hooks.example.test/events?x=arbitrary-secret&token=sentinel#fragment-secret";
    const originalHeaders = {
        "Content-Type": "application/json",
        "User-Agent": "WA-AKG-Webhook/1.0",
        "X-Webhook-Signature": "sha256=signature-sentinel",
    };
    const persisted = sanitizeWebhookLog({
        requestUrl: originalUrl,
        requestHeaders: originalHeaders,
        requestBody: { event: "message.sent" },
    });

    // Redaction applies only to persisted/returned log copies, never to the outbound request.
    assert.equal(originalUrl, "https://hooks.example.test/events?x=arbitrary-secret&token=sentinel#fragment-secret");
    assert.equal(originalHeaders["X-Webhook-Signature"], "sha256=signature-sentinel");
    assert.equal(persisted.requestUrl, "https://hooks.example.test/events");
    assert.deepEqual(persisted.requestHeaders, {
        "Content-Type": "application/json",
        "User-Agent": "WA-AKG-Webhook/1.0",
    });
    assert.equal(JSON.stringify(persisted).includes("signature-sentinel"), false);
    assert.equal(JSON.stringify(persisted).includes("arbitrary-secret"), false);
    assert.equal(JSON.stringify(persisted).includes("fragment-secret"), false);
    assert.deepEqual(persisted.requestBody, { event: "message.sent" });
});

test("legacy log serialization removes case-insensitive HMAC headers and URL credentials", () => {
    const legacyLog = {
        id: "legacy-log",
        requestUrl: "https://hooks.example.test/events?opaque=old-secret#old-fragment",
        requestHeaders: {
            "content-type": "application/json",
            "x-webhook-signature": "old-signature-sentinel",
            "X-Other-Header": "preserved",
        },
    };

    const returned = sanitizeWebhookLog(legacyLog);

    assert.equal(returned.requestUrl, "https://hooks.example.test/events");
    assert.deepEqual(returned.requestHeaders, {
        "content-type": "application/json",
        "X-Other-Header": "preserved",
    });
    assert.equal(JSON.stringify(returned).includes("old-signature-sentinel"), false);
    assert.equal(JSON.stringify(returned).includes("old-secret"), false);
});

test("header sanitization preserves required headers and ignores non-object JSON", () => {
    assert.deepEqual(sanitizeWebhookRequestHeaders({
        "Content-Type": "application/json",
        "User-Agent": "WA-AKG-Webhook/1.0",
        "X-WEBHOOK-SIGNATURE": "sentinel",
    }), {
        "Content-Type": "application/json",
        "User-Agent": "WA-AKG-Webhook/1.0",
    });
    assert.equal(sanitizeWebhookRequestHeaders(null), null);
    assert.deepEqual(sanitizeWebhookRequestHeaders(["not", "headers"]), ["not", "headers"]);
});

test("shared URL redaction is safe for malformed legacy values", () => {
    assert.equal(sanitizeWebhookUrl("invalid-url?token=secret#fragment"), "invalid-url");
});
