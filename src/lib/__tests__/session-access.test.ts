import assert from "node:assert/strict";
import test from "node:test";
import { mayManageSession, SAFE_WEBHOOK_SELECT, sanitizeOAuthReadSession, sanitizeSessionWebhooks, sanitizeSharedSession } from "../session-access";

test("session projections omit webhook secrets and serializer strips them defensively", () => {
    assert.equal("secret" in SAFE_WEBHOOK_SELECT, false);
    const session = {
        id: "session-test",
        webhooks: [
            { id: "webhook-test", url: "https://example.test/hook", secret: "sentinel-secret" },
            { id: "webhook-no-secret", url: "https://example.test/other" }
        ]
    };

    const result = sanitizeSessionWebhooks(session);
    assert.deepEqual(result.webhooks, [
        { id: "webhook-test", url: "https://example.test/hook" },
        { id: "webhook-no-secret", url: "https://example.test/other" }
    ]);
    assert.equal(JSON.stringify(result).includes("sentinel-secret"), false);
});

test("shared session responses omit pairing QR and bot API credentials", () => {
    const result = sanitizeSharedSession({
        id: "session-shared",
        qr: "sentinel-qr",
        botConfig: { enabled: true, removeBgApiKey: "sentinel-api-key" },
    });

    assert.equal("qr" in result, false);
    assert.deepEqual(result.botConfig, { enabled: true });
    assert.equal(JSON.stringify(result).includes("sentinel-qr"), false);
    assert.equal(JSON.stringify(result).includes("sentinel-api-key"), false);
});

test("shared session webhook URLs omit query and fragment while owner URLs stay complete", () => {
    const webhookUrl = "https://hooks.example.test/events?token=query-secret&mode=fast#fragment-secret";
    const session = {
        id: "session-shared",
        webhooks: [{ id: "webhook-1", url: webhookUrl, secret: "hmac-secret" }],
    };

    const ownerView = sanitizeSessionWebhooks(session);
    const sharedView = sanitizeSessionWebhooks(sanitizeSharedSession(session));

    assert.equal(ownerView.webhooks[0].url, webhookUrl);
    assert.equal(ownerView.webhooks[0].secret, undefined);
    assert.equal(sharedView.webhooks[0].url, "https://hooks.example.test/events");
    assert.equal(JSON.stringify(sharedView).includes("query-secret"), false);
    assert.equal(JSON.stringify(sharedView).includes("fragment-secret"), false);
    assert.equal(JSON.stringify(sharedView).includes("hmac-secret"), false);
});

test("OAuth read session projections redact connection and configuration secrets", () => {
    const result = sanitizeOAuthReadSession({
        id: "session-read-only",
        qr: "sentinel-qr",
        pairingCode: "sentinel-pairing-code",
        config: { webhookToken: "sentinel-session-token", safeSetting: true },
        botConfig: {
            enabled: true,
            removeBgApiKey: "sentinel-api-key",
            nested: { clientSecret: "sentinel-client-secret", visible: "kept" },
        },
        webhooks: [{
            url: "https://hooks.example.test/events?token=sentinel-query",
            requestHeaders: "Authorization: Bearer sentinel-header",
            secret: "sentinel-hmac",
        }],
    });

    assert.equal("qr" in result, false);
    assert.equal("pairingCode" in result, false);
    assert.equal("config" in result, false);
    assert.deepEqual(result.botConfig, { enabled: true, nested: { visible: "kept" } });
    assert.deepEqual(result.webhooks, [{ url: "https://hooks.example.test/events" }]);
    assert.equal(JSON.stringify(result).includes("sentinel"), false);
});

test("only the session owner may manage session settings without audited privilege", () => {
    assert.equal(mayManageSession("shared-user", "USER", "owner-user"), false);
    assert.equal(mayManageSession("owner-user", "USER", "owner-user"), true);
    assert.equal(mayManageSession("admin-user", "SUPERADMIN", "owner-user"), false);
});
