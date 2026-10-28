import assert from "node:assert/strict";
import test from "node:test";
import {
    isExplicitlyAllowedLocalIp,
    isPrivateOrReservedIp,
    mergeRequestHeaders,
    parseRequestHeaders,
    safeRequest,
    validateSafeUrl,
} from "../security";
import { sanitizeWebhookRequestHeaders } from "../webhook-redaction";

const publicAddress = "93.184.216.34";

test("rejects non-global and reserved IPv4 and IPv6 destinations", () => {
    for (const address of [
        "127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1",
        "192.0.2.1", "198.18.0.1", "203.0.113.1", "224.0.0.1", "::1",
        "::ffff:127.0.0.1", "2001:db8::1", "fc00::1", "fe80::1", "2002::1"
    ]) assert.equal(isPrivateOrReservedIp(address), true, `${address} must be blocked`);

    assert.equal(isPrivateOrReservedIp(publicAddress), false);
    assert.equal(isPrivateOrReservedIp("2606:4700:4700::1111"), false);
});

test("rejects a DNS response containing any private address before connecting", async () => {
    let requestCount = 0;
    const validation = await validateSafeUrl("https://hooks.example.test/event", {}, async () => [
        { address: publicAddress, family: 4 },
        { address: "127.0.0.1", family: 4 }
    ]);
    assert.equal(validation.valid, false);

    await assert.rejects(() => safeRequest("https://hooks.example.test/event", {}, {
        lookup: async () => [
            { address: publicAddress, family: 4 },
            { address: "127.0.0.1", family: 4 }
        ],
        request: async () => {
            requestCount++;
            return { status: 200, statusText: "OK", headers: new Headers(), body: Buffer.from("ok") };
        }
    }), /private or reserved/);
    assert.equal(requestCount, 0);
});

test("pins the HTTP transport to the validated DNS answer", async () => {
    let lookupCount = 0;
    let connectedAddress: string | undefined;
    const response = await safeRequest("https://hooks.example.test/event", { method: "POST", body: "{}" }, {
        lookup: async () => {
            lookupCount++;
            return [{ address: publicAddress, family: 4 }];
        },
        request: async (_url, pinnedAddress, options) => {
            connectedAddress = pinnedAddress;
            assert.equal(options.method, "POST");
            assert.equal(options.body, "{}");
            return { status: 204, statusText: "No Content", headers: new Headers(), body: Buffer.alloc(0) };
        }
    });

    assert.equal(response.status, 204);
    assert.equal(lookupCount, 1);
    assert.equal(connectedAddress, publicAddress);
});

test("revalidates redirect destinations and rejects private redirect targets", async () => {
    let requests = 0;
    await assert.rejects(() => safeRequest("https://hooks.example.test/start", {
        followRedirects: true,
        method: "GET",
        allowHttp: true
    }, {
        lookup: async hostname => hostname === "hooks.example.test"
            ? [{ address: publicAddress, family: 4 }]
            : [],
        request: async () => {
            requests++;
            const headers = new Headers({ location: "http://127.0.0.1/admin" });
            return { status: 302, statusText: "Found", headers, body: Buffer.alloc(0) };
        }
    }), /private or reserved/);
    assert.equal(requests, 1);
});

test("enforces bounded response bodies even with an injected transport", async () => {
    await assert.rejects(() => safeRequest("https://hooks.example.test/large", { maxBytes: 4 }, {
        lookup: async () => [{ address: publicAddress, family: 4 }],
        request: async () => ({ status: 200, statusText: "OK", headers: new Headers(), body: Buffer.from("12345") })
    }), /size limit/);
});

test("supports HTTP and explicitly opted-in loopback and RFC1918 destinations", async () => {
    assert.equal((await validateSafeUrl("http://hooks.example.test/event", { allowHttp: true }, async () => [
        { address: publicAddress, family: 4 },
    ])).valid, true);

    assert.equal((await validateSafeUrl("http://127.0.0.1:8080/event", { allowHttp: true })).valid, false);
    assert.equal((await validateSafeUrl("http://127.0.0.1:8080/event", { allowHttp: true, allowLocal: true })).valid, true);
    assert.equal((await validateSafeUrl("http://192.168.1.10/event", { allowHttp: true, allowLocal: true })).valid, true);
    assert.equal((await validateSafeUrl("http://localhost/event", { allowHttp: true, allowLocal: true }, async () => [
        { address: "127.0.0.1", family: 4 },
    ])).valid, true);

    assert.equal(isExplicitlyAllowedLocalIp("127.0.0.1"), true);
    assert.equal(isExplicitlyAllowedLocalIp("192.168.1.10"), true);
    assert.equal(isExplicitlyAllowedLocalIp("169.254.169.254"), false);
});

test("keeps metadata, link-local, multicast and reserved destinations blocked with local opt-in", async () => {
    for (const [address, urlAddress] of [[
        "169.254.169.254", "169.254.169.254",
    ], [
        "224.0.0.1", "224.0.0.1",
    ], [
        "0.0.0.0", "0.0.0.0",
    ], [
        "fc00::1", "[fc00::1]",
    ]] as const) {
        const validation = await validateSafeUrl(`http://${urlAddress}/event`, { allowHttp: true, allowLocal: true });
        assert.equal(validation.valid, false, `${address} must remain blocked`);
    }
});

test("parses bounded multiline request headers and rejects unsafe configuration", () => {
    assert.deepEqual(parseRequestHeaders(
        "Authorization: Bearer token\nCookie: session=opaque\nX-API-Key: api-key",
    ), {
        Authorization: "Bearer token",
        Cookie: "session=opaque",
        "X-API-Key": "api-key",
    });

    assert.throws(() => parseRequestHeaders("X-Trace: one\n x-trace: two"), /Duplicate/);
    assert.throws(() => parseRequestHeaders("Authorization: token\r\nX-Trace: value"), /CRLF/);
    assert.throws(() => parseRequestHeaders("Content-Type: text/plain"), /controlled/);
    assert.throws(() => parseRequestHeaders("Bad Header: value"), /Invalid HTTP header name/);
    assert.throws(() => parseRequestHeaders(42), /text value/);

    assert.deepEqual(mergeRequestHeaders(
        { authorization: "user", "X-Trace": "trace" },
        { "Content-Type": "application/json", "User-Agent": "WA-AKG-Webhook/1.0" },
    ), {
        authorization: "user",
        "X-Trace": "trace",
        "Content-Type": "application/json",
        "User-Agent": "WA-AKG-Webhook/1.0",
    });

    assert.deepEqual(mergeRequestHeaders(
        { "content-type": "user-value", "x-webhook-signature": "user-value" },
        { "Content-Type": "application/json", "X-Webhook-Signature": "internal-value" },
    ), {
        "Content-Type": "application/json",
        "X-Webhook-Signature": "internal-value",
    });
});

test("redacts credential-bearing webhook headers without exposing values", () => {
    const redacted = sanitizeWebhookRequestHeaders({
        Authorization: "Bearer secret-token",
        Cookie: "session=secret-cookie",
        "X-API-Key": "secret-api-key",
        "X-Trace": "safe-value",
        "X-Webhook-Signature": "sha256=secret-hmac",
    });

    assert.deepEqual(redacted, {
        Authorization: "[REDACTED]",
        Cookie: "[REDACTED]",
        "X-API-Key": "[REDACTED]",
        "X-Trace": "safe-value",
    });
    assert.equal(JSON.stringify(redacted).includes("secret"), false);
});
