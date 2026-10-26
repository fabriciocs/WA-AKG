import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createBroadcastRecipientProcessor } from "@/lib/cron";

const fixedNow = new Date("2026-10-24T12:00:00.000Z");

function createBroadcastHarness(options: {
    logClaimCount?: number;
    recipientClaimCount?: number;
    sendError?: Error;
    attempts?: number;
    connected?: boolean;
} = {}) {
    const log = {
        id: "broadcast-1",
        status: "running",
        claimToken: null as string | null,
        claimedAt: null as Date | null,
        sessionId: "session-1",
        message: "mock broadcast",
        delay: 1000,
        total: 1
    };
    const recipient = {
        id: "recipient-1",
        broadcastLogId: log.id,
        status: "pending",
        claimToken: null as string | null,
        claimedAt: null as Date | null,
        attempts: options.attempts ?? 0,
        jid: "5511999999999@s.whatsapp.net",
        nextAttemptAt: null as Date | null,
        sentAt: null as Date | null,
        error: null as string | null,
        broadcastLog: log
    };
    const logUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
    const recipientUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
    const sends: Array<{ sessionId: string; jid: string; content: { text: string } }> = [];
    const progress: Array<{ sessionId: string; payload: unknown }> = [];
    const errors: string[] = [];
    const stopped: string[] = [];
    const sleeps: number[] = [];
    let logClaimAvailable = true;
    let recipientClaimAvailable = true;
    let candidateReturned = false;

    const fakeLogDelegate = {
        findMany: async () => [{ id: log.id }],
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            logUpdates.push({ where, data });
            if (data.claimToken === "log-token") {
                if (!logClaimAvailable || options.logClaimCount === 0) return { count: 0 };
                logClaimAvailable = false;
                Object.assign(log, data);
                return { count: 1 };
            }
            if (where.claimToken !== log.claimToken) return { count: 0 };
            if (data.status === "completed") {
                Object.assign(log, data);
                return { count: 1 };
            }
            if (data.claimToken === null && log.status === "running") {
                Object.assign(log, data);
                return { count: 1 };
            }
            return { count: 0 };
        }
    } as unknown as PrismaClient["broadcastLog"];

    const fakeRecipientDelegate = {
        findFirst: async ({ where, select, include }: {
            where: Record<string, unknown>;
            select?: Record<string, unknown>;
            include?: Record<string, unknown>;
        }) => {
            if (where.claimToken === "recipient-token") {
                return where.claimToken === recipient.claimToken ? { ...recipient, broadcastLog: log } : null;
            }
            if (where.status === "sent") return null;
            if (select?.id && !include) {
                if (candidateReturned || recipient.status !== "pending") return null;
                if (recipient.nextAttemptAt && recipient.nextAttemptAt > fixedNow) return null;
                candidateReturned = true;
                return { id: recipient.id };
            }
            return null;
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            recipientUpdates.push({ where, data });
            if (data.status === "processing") {
                if (!recipientClaimAvailable || options.recipientClaimCount === 0) return { count: 0 };
                recipientClaimAvailable = false;
                recipient.attempts++;
                Object.assign(recipient, data, { attempts: recipient.attempts });
                return { count: 1 };
            }
            if (where.claimToken !== recipient.claimToken) return { count: 0 };
            Object.assign(recipient, data);
            return { count: 1 };
        },
        count: async ({ where }: { where: { status: string | { in: string[] } } }) => {
            if (where.status === "sent") return recipient.status === "sent" ? 1 : 0;
            if (where.status === "failed") return recipient.status === "failed" ? 1 : 0;
            return ["pending", "processing"].includes(recipient.status) ? 1 : 0;
        }
    } as unknown as PrismaClient["broadcastRecipient"];

    const process = createBroadcastRecipientProcessor({
        broadcastLog: fakeLogDelegate,
        broadcastRecipient: fakeRecipientDelegate,
        getSender: sessionId => options.connected === false ? undefined : async (jid, content) => {
            sends.push({ sessionId, jid, content });
            if (options.sendError) throw options.sendError;
        },
        startHeartbeat: (_id, token) => () => stopped.push(token),
        createToken: (() => {
            let count = 0;
            return () => count++ === 0 ? "log-token" : "recipient-token";
        })(),
        now: () => new Date(fixedNow),
        sleep: async milliseconds => { sleeps.push(milliseconds); },
        logError: message => errors.push(message),
        emitProgress: (sessionId, payload) => progress.push({ sessionId, payload })
    });

    return { process, log, recipient, logUpdates, recipientUpdates, sends, progress, errors, stopped, sleeps };
}

test("broadcast log claim is atomic and a lost claim skips recipient work", async () => {
    const harness = createBroadcastHarness({ logClaimCount: 0 });

    await harness.process(fixedNow);

    assert.equal(harness.recipientUpdates.length, 0);
    assert.equal(harness.sends.length, 0);
    assert.equal(harness.stopped.length, 0);
    assert.equal(harness.logUpdates.length, 1);
});

test("recipient send marks completion and releases both leases", async () => {
    const harness = createBroadcastHarness();

    await harness.process(fixedNow);

    assert.deepEqual(harness.sends, [{
        sessionId: "session-1",
        jid: "5511999999999@s.whatsapp.net",
        content: { text: "mock broadcast" }
    }]);
    assert.equal(harness.recipient.status, "sent");
    assert.equal(harness.recipient.claimToken, null);
    assert.equal(harness.log.status, "completed");
    assert.equal(harness.log.claimToken, null);
    assert.deepEqual(harness.stopped, ["log-token"]);
    assert.equal(harness.logUpdates.at(-1)?.data.claimToken, null);
    assert.equal(harness.progress.length, 1);
});

test("failed recipient send is retried later and parent log lease is released", async () => {
    const harness = createBroadcastHarness({ sendError: new Error("temporary failure") });

    await harness.process(fixedNow);

    assert.equal(harness.sends.length, 1);
    assert.equal(harness.recipient.status, "pending");
    assert.equal(harness.recipient.claimToken, null);
    assert.equal(harness.recipient.claimedAt, null);
    assert.equal(harness.recipient.error, "temporary failure");
    assert.equal(harness.recipient.nextAttemptAt?.getTime(), fixedNow.getTime() + 2000);
    assert.equal(harness.log.status, "running");
    assert.equal(harness.log.claimToken, null);
    assert.deepEqual(harness.stopped, ["log-token"]);
});

test("recipient failure at the attempt limit becomes terminal and releases its lease", async () => {
    const harness = createBroadcastHarness({ attempts: 2, sendError: new Error("still failing") });

    await harness.process(fixedNow);

    assert.equal(harness.recipient.attempts, 3);
    assert.equal(harness.recipient.status, "failed");
    assert.equal(harness.recipient.claimToken, null);
    assert.equal(harness.recipient.nextAttemptAt, null);
    assert.equal(harness.log.claimToken, null);
});

test("lost recipient claim never sends and parent lease is released", async () => {
    const harness = createBroadcastHarness({ recipientClaimCount: 0 });

    await harness.process(fixedNow);

    assert.equal(harness.sends.length, 0);
    assert.equal(harness.recipient.status, "pending");
    assert.equal(harness.log.claimToken, null);
    assert.deepEqual(harness.stopped, ["log-token"]);
});
