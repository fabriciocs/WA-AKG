import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateOrReservedIp, safeRequest, validateSafeUrl } from "../security";

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
