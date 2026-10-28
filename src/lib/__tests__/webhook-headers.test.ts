import assert from "node:assert/strict";
import test from "node:test";
import { protectWebhookRequestHeaders, revealWebhookRequestHeaders } from "../webhook-headers";

test("protects webhook headers at rest and reveals a canonical multiline value", () => {
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "unit-test-webhook-header-key";
    try {
        const stored = protectWebhookRequestHeaders("Authorization: Bearer token\nX-Source: test");
        assert.ok(stored?.startsWith("enc:v1:"));
        assert.equal(stored?.includes("Bearer token"), false);
        assert.equal(revealWebhookRequestHeaders(stored), "Authorization: Bearer token\nX-Source: test");
    } finally {
        if (previous === undefined) delete process.env.AUTH_SECRET;
        else process.env.AUTH_SECRET = previous;
    }
});
