import assert from "node:assert/strict";
import test from "node:test";
import { hashIdempotencyKey, hashTextRequest, parseIdempotentTextPayload, validateIdempotencyKey } from "@/modules/messaging/idempotency";

test("validates visible ASCII idempotency keys and rejects unsafe sizes", () => {
    assert.equal(validateIdempotencyKey("client-request-1"), "client-request-1");
    assert.equal(validateIdempotencyKey(""), null);
    assert.equal(validateIdempotencyKey("contains space"), null);
    assert.equal(validateIdempotencyKey("x".repeat(129)), null);
});

test("stores a digest instead of the idempotency key", () => {
    const digest = hashIdempotencyKey("client-request-1");
    assert.equal(digest.length, 64);
    assert.notEqual(digest, "client-request-1");
    assert.equal(digest, hashIdempotencyKey("client-request-1"));
});

test("fingerprints normalized text requests deterministically", () => {
    const payload = { message: "hello", mentions: ["123@s.whatsapp.net"], quotedMessageId: null };
    assert.equal(hashTextRequest("123@s.whatsapp.net", payload), hashTextRequest("123@s.whatsapp.net", payload));
    assert.notEqual(hashTextRequest("123@s.whatsapp.net", payload), hashTextRequest("456@s.whatsapp.net", payload));
});

test("accepts text-only payloads and rejects media or malformed fields", () => {
    assert.deepEqual(parseIdempotentTextPayload({ message: { text: "hello" }, mentions: [] }), { message: "hello", mentions: [], quotedMessageId: null });
    assert.equal(parseIdempotentTextPayload({ message: { text: "hello" }, image: "https://example.test/a.jpg" }), null);
    assert.equal(parseIdempotentTextPayload({ message: { text: "   " } }), null);
    assert.equal(parseIdempotentTextPayload({ message: { text: "x".repeat(4097) } }), null);
    assert.equal(parseIdempotentTextPayload({ message: { text: "hello" }, mentions: Array(101).fill("1@s.whatsapp.net") }), null);
});
