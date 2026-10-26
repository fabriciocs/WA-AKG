import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { normalizeBroadcastInput } from "@/lib/broadcast-validation";
import { isSafeAutoReplyRegex } from "@/modules/whatsapp/store/autoreply";
import { AntiSpamManager } from "@/modules/whatsapp/antispam";

test("broadcast input is bounded, rejects group JIDs and deduplicates recipients", () => {
    const result = normalizeBroadcastInput({
        recipients: ["5511999999999@s.whatsapp.net", "5511999999999@s.whatsapp.net"],
        message: " hello ",
        delay: 1500
    });
    assert.equal(result.success, true);
    if (result.success) {
        assert.deepEqual(result.data.recipients, ["5511999999999@s.whatsapp.net"]);
        assert.equal(result.data.message, "hello");
    }

    assert.equal(normalizeBroadcastInput({ recipients: ["123@g.us"], message: "x" }).success, false);
    assert.equal(normalizeBroadcastInput({ recipients: [], message: "x" }).success, false);
    assert.equal(normalizeBroadcastInput({ recipients: ["5511999999999@s.whatsapp.net"], message: "x", delay: 0 }).success, false);
});

test("auto-reply regex policy rejects catastrophic nested quantifiers", () => {
    assert.equal(isSafeAutoReplyRegex("^hello.*$"), true);
    assert.equal(isSafeAutoReplyRegex("(a+)+$"), false);
    assert.equal(isSafeAutoReplyRegex("(a|aa)*b"), false);
    assert.equal(isSafeAutoReplyRegex("a".repeat(129)), false);
    assert.equal(isSafeAutoReplyRegex("["), false);
});

test("send lock serializes actual sends across independent manager instances", async () => {
    const state: { nextAllowedAt: Date | null; leaseToken: string | null; leaseUntil: Date | null } = {
        nextAllowedAt: null,
        leaseToken: null,
        leaseUntil: null
    };
    const fakeDb = {
        session: { findUnique: async () => ({ botConfig: {
            antiSpamEnabled: true,
            spamLimit: 100,
            spamInterval: 1,
            spamDelayMin: 1,
            spamDelayMax: 1
        } }) },
        whatsAppSendThrottle: {
            upsert: async () => state,
            findUnique: async () => ({ ...state }),
            updateMany: async ({ where, data }: {
                where: { leaseToken?: string | null };
                data: Partial<typeof state>;
            }) => {
                if (data.leaseToken) {
                    if (state.leaseToken && state.leaseUntil && state.leaseUntil > new Date()) return { count: 0 };
                    Object.assign(state, data);
                    return { count: 1 };
                }
                if (where.leaseToken !== state.leaseToken) return { count: 0 };
                Object.assign(state, data);
                return { count: 1 };
            }
        }
    } as unknown as PrismaClient;

    const first = new AntiSpamManager(fakeDb);
    const second = new AntiSpamManager(fakeDb);
    let active = 0;
    let maxActive = 0;
    const send = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active--;
        return "sent";
    };

    const results = await Promise.all([
        first.enqueue("session-a", "5511999999999@s.whatsapp.net", { text: "a" }, send),
        second.enqueue("session-a", "5511888888888@s.whatsapp.net", { text: "b" }, send)
    ]);
    assert.deepEqual(results, ["sent", "sent"]);
    assert.equal(maxActive, 1);
});
