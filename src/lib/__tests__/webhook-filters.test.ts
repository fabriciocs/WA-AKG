import { test } from "node:test";
import { MessageType } from "@prisma/client";
import { WEBHOOK_MESSAGE_TYPES as browserMessageTypes } from "../webhook-filter-constants";
import assert from "node:assert/strict";
import { getWebhookFilterUpdate, matchesWebhookFilters, normalizeWebhookFilters, type WebhookFilters } from "../webhook-filters";

test("empty, blank, null and omitted criteria preserve legacy delivery", () => {
    assert.equal(normalizeWebhookFilters(undefined), null);
    assert.equal(normalizeWebhookFilters(null), null);
    assert.equal(normalizeWebhookFilters({}), null);
    assert.equal(normalizeWebhookFilters({ sessionId: "  ", senderJid: null, chatJid: "" }), null);
    assert.equal(matchesWebhookFilters(null, { sessionId: "s", data: {} }), true);
});

test("false booleans are retained and matched", () => {
    const filters = normalizeWebhookFilters({ fromMe: false, isGroup: false });
    assert.deepEqual(filters, { fromMe: false, isGroup: false });
    assert.equal(matchesWebhookFilters(filters, { data: { key: { fromMe: false }, isGroup: false } }), true);
    assert.equal(matchesWebhookFilters(filters, { data: { key: { fromMe: true }, isGroup: false } }), false);
});

const message = { sessionId: "session-a", data: { from: "chat@g.us", sender: { id: "sender@s.whatsapp.net" }, key: { remoteJid: "chat@g.us", participant: { id: "sender@s.whatsapp.net" }, fromMe: false }, type: "IMAGE", isGroup: true, chatType: "GROUP" } };
const cases: [keyof WebhookFilters, unknown][] = [
    ["sessionId", "session-a"], ["senderJid", "sender@s.whatsapp.net"], ["chatJid", "chat@g.us"],
    ["messageType", "IMAGE"], ["fromMe", false], ["isGroup", true], ["chatType", "GROUP"],
];
for (const [key, value] of cases) test(`matches individual ${key} filter`, () => {
    assert.equal(matchesWebhookFilters({ [key]: value } as WebhookFilters, message), true);
});

test("criteria combine with AND and missing event values fail closed", () => {
    assert.equal(matchesWebhookFilters({ chatType: "GROUP", messageType: "IMAGE", fromMe: false }, message), true);
    assert.equal(matchesWebhookFilters({ chatType: "GROUP", messageType: "VIDEO" }, message), false);
    assert.equal(matchesWebhookFilters({ messageType: "IMAGE" }, { sessionId: "session-a", data: { remoteJid: "chat@g.us" } }), false);
});

test("senderJid uses the actual group participant and handles self-sent messages", () => {
    const groupPayload = { sessionId: "s", data: { from: "120363@g.us", sender: { id: "187398029836311@lid" }, key: { remoteJid: "120363@g.us", participant: { id: "187398029836311@lid" }, fromMe: false }, isGroup: true, chatType: "GROUP", type: "TEXT" } };
    assert.equal(matchesWebhookFilters({ senderJid: "187398029836311@lid" }, groupPayload), true);
    assert.equal(matchesWebhookFilters({ senderJid: "120363@g.us" }, groupPayload), false);
    assert.equal(matchesWebhookFilters({ chatJid: "123@lid" }, { data: { key: { remoteJid: "123@s.whatsapp.net" } } }), false);
    const sentPayload = { event: "message.sent", sessionId: "s", data: { from: "own@s.whatsapp.net", sender: "ME", key: { remoteJid: "target@s.whatsapp.net", fromMe: true }, isGroup: false, chatType: "PERSONAL", type: "TEXT" } };
    assert.equal(matchesWebhookFilters({ senderJid: "own@s.whatsapp.net" }, sentPayload), true);
});

test("raw sender and chat JIDs take precedence over normalized compatibility fields", () => {
    const payload = { data: { senderJid: "187398029836311@lid", sender: "5511999999999@s.whatsapp.net", chatJid: "123@lid", key: { remoteJid: "123@s.whatsapp.net" }, type: "TEXT" } };
    assert.equal(matchesWebhookFilters({ senderJid: "187398029836311@lid" }, payload), true);
    assert.equal(matchesWebhookFilters({ senderJid: "5511999999999@s.whatsapp.net" }, payload), false);
    assert.equal(matchesWebhookFilters({ chatJid: "123@lid" }, payload), true);
    assert.equal(matchesWebhookFilters({ chatJid: "123@s.whatsapp.net" }, payload), false);
});

test("filter strings enforce documented length limits", () => {
    assert.equal(normalizeWebhookFilters({ sessionId: "s".repeat(191) })?.sessionId?.length, 191);
    assert.throws(() => normalizeWebhookFilters({ sessionId: "s".repeat(192) }), /at most 191/);
    assert.equal(normalizeWebhookFilters({ senderJid: "j".repeat(512) })?.senderJid?.length, 512);
    assert.throws(() => normalizeWebhookFilters({ senderJid: "j".repeat(513) }), /at most 512/);
    assert.throws(() => normalizeWebhookFilters({ chatJid: "j".repeat(513) }), /at most 512/);
});
test("filter validation rejects unknown keys, invalid types and enum values", () => {
    for (const input of [{ extra: "x" }, { fromMe: "false" }, { isGroup: 0 }, { messageType: "REACTION" }, { chatType: "DIRECT" }, "bad", []]) {
        assert.throws(() => normalizeWebhookFilters(input));
    }
});

test("browser-safe options cover Prisma and interactive message types", () => {
    const options: readonly string[] = browserMessageTypes;
    for (const messageType of Object.values(MessageType)) assert.ok(options.includes(messageType));
    for (const messageType of ["INTERACTIVE_RESPONSE", "BUTTON_RESPONSE", "LIST_RESPONSE"]) assert.ok(options.includes(messageType));
});
test("interactive webhook message types are valid filter values", () => {
    for (const messageType of ["INTERACTIVE_RESPONSE", "BUTTON_RESPONSE", "LIST_RESPONSE"]) {
        assert.deepEqual(normalizeWebhookFilters({ messageType }), { messageType });
        assert.equal(matchesWebhookFilters({ messageType } as WebhookFilters, { data: { type: messageType } }), true);
    }
});

test("POST normalization and PUT preserve/replace/clear semantics", () => {
    assert.deepEqual(normalizeWebhookFilters({ chatJid: " chat@g.us " }), { chatJid: "chat@g.us" });
    assert.deepEqual(getWebhookFilterUpdate({}), { supplied: false });
    assert.deepEqual(getWebhookFilterUpdate({ filters: { fromMe: false } }), { supplied: true, value: { fromMe: false } });
    assert.deepEqual(getWebhookFilterUpdate({ filters: {} }), { supplied: true, value: null });
    assert.deepEqual(getWebhookFilterUpdate({ filters: null }), { supplied: true, value: null });
});
