import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createScheduledMessageProcessor, createSingleFlightRunner } from "@/lib/cron";

const now = new Date("2026-10-24T12:00:00.000Z");

type FakeJob = {
    id: string;
    sessionId: string;
    jid: string;
    content: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
    cronExpression: string | null;
    attempts: number;
    session: { sessionId: string };
};

function createHarness(options: {
    claimCount?: number;
    connected?: boolean;
    cronExpression?: string | null;
    sendError?: Error;
    finalUpdateCount?: number;
    finalUpdateError?: Error;
} = {}) {
    const job: FakeJob = {
        id: "job-1",
        sessionId: "session-1",
        jid: "5511999999999@s.whatsapp.net",
        content: "hello",
        mediaUrl: null,
        mediaType: null,
        cronExpression: options.cronExpression ?? null,
        attempts: 0,
        session: { sessionId: "session-1" }
    };
    const state: { status: string; claimToken: string | null; claimedAt: Date | null; sendAt: Date; attempts: number; lastError: string | null } = {
        status: "PENDING",
        claimToken: null,
        claimedAt: null,
        sendAt: now,
        attempts: 0,
        lastError: null
    };
    const updates: Array<{ where: { id?: string; claimToken?: string }; data: Record<string, unknown> }> = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const sends: Array<{ sessionId: string; jid: string; content: unknown }> = [];
    const stopped: string[] = [];
    let claimAvailable = options.claimCount !== 0;

    const fakeDelegate = {
        findMany: async () => [{ id: job.id }],
        findFirst: async ({ where }: { where: { id: string; claimToken: string } }) =>
            where.id === job.id && where.claimToken === state.claimToken ? { ...job, attempts: state.attempts } : null,
        updateMany: async ({ where, data }: { where: { id?: string; claimToken?: string }; data: Record<string, unknown> }) => {
            updates.push({ where, data });
            if (data.status === "PROCESSING") {
                if (!claimAvailable) return { count: 0 };
                claimAvailable = false;
                Object.assign(state, data);
                return { count: 1 };
            }
            if (where.claimToken !== state.claimToken || where.id !== job.id) {
                return { count: options.finalUpdateCount ?? 0 };
            }
            if (options.finalUpdateError && (data.status === "SENT" || data.status === "PENDING" || data.status === "FAILED")) {
                throw options.finalUpdateError;
            }
            const count = options.finalUpdateCount ?? 1;
            if (count === 1) Object.assign(state, data);
            return { count };
        }
    } as unknown as PrismaClient["scheduledMessage"];

    const process = createScheduledMessageProcessor({
        scheduledMessage: fakeDelegate,
        getSender: sessionId => options.connected === false ? undefined : async (jid, content) => {
            sends.push({ sessionId, jid, content });
            if (options.sendError) throw options.sendError;
        },
        buildContent: async message => ({ text: message.content || "" }),
        startHeartbeat: (_id, token) => {
            return () => stopped.push(token);
        },
        createToken: () => "lease-token-1",
        logError: message => errors.push(message),
        logWarn: message => warnings.push(message)
    });

    return { process, state, updates, errors, warnings, sends, stopped };
}

test("scheduled message claim is atomic; a lost claim never sends", async () => {
    const harness = createHarness({ claimCount: 0 });

    await harness.process(now);

    assert.equal(harness.sends.length, 0);
    assert.equal(harness.stopped.length, 0);
    assert.equal(harness.updates.length, 1);
    assert.deepEqual(harness.updates[0].data, {
        status: "PROCESSING",
        claimToken: "lease-token-1",
        claimedAt: now,
        attempts: { increment: 1 }
    });
});

test("successful scheduled send persists SENT and releases its lease", async () => {
    const harness = createHarness();

    await harness.process(now);

    assert.equal(harness.sends.length, 1);
    assert.equal(harness.sends[0].sessionId, "session-1");
    assert.equal(harness.state.status, "SENT");
    assert.equal(harness.state.claimToken, null);
    assert.equal(harness.state.claimedAt, null);
    assert.deepEqual(harness.stopped, ["lease-token-1"]);
});

test("disconnected session releases the lease and returns the job to PENDING", async () => {
    const harness = createHarness({ connected: false });

    await harness.process(now);

    assert.equal(harness.sends.length, 0);
    assert.equal(harness.state.status, "PENDING");
    assert.equal(harness.state.claimToken, null);
    assert.equal(harness.state.claimedAt, null);
    assert.equal(harness.warnings.length, 1);
});

test("failed one-time send marks FAILED and releases its lease", async () => {
    const harness = createHarness({ sendError: new Error("transport rejected") });

    await harness.process(now);

    assert.equal(harness.state.status, "FAILED");
    assert.equal(harness.state.claimToken, null);
    assert.equal(harness.state.claimedAt, null);
    assert.equal(harness.state.lastError, "transport rejected");
    assert.match(harness.errors[0], /Scheduled send failed/);
});

test("failed recurring send schedules the next run and releases its lease", async () => {
    const harness = createHarness({
        cronExpression: "*/5 * * * *",
        sendError: new Error("temporary provider failure")
    });

    await harness.process(now);

    assert.equal(harness.state.status, "PENDING");
    assert.ok(harness.state.sendAt > now);
    assert.equal(harness.state.claimToken, null);
    assert.equal(harness.state.claimedAt, null);
    assert.equal(harness.state.lastError, "temporary provider failure");
});

test("database failure after the send leaves the claim for lease recovery", async () => {
    const harness = createHarness({ finalUpdateError: new Error("db unavailable") });

    await harness.process(now);

    assert.equal(harness.sends.length, 1);
    assert.equal(harness.state.status, "PROCESSING");
    assert.equal(harness.state.claimToken, "lease-token-1");
    assert.equal(harness.errors.length, 1);
    assert.match(harness.errors[0], /lease recovery will retry/);
    assert.deepEqual(harness.stopped, ["lease-token-1"]);
});

test("a lease lost after sending is logged instead of reporting the job as SENT", async () => {
    const harness = createHarness({ finalUpdateCount: 0 });

    await harness.process(now);

    assert.equal(harness.sends.length, 1);
    assert.equal(harness.state.status, "PROCESSING");
    assert.equal(harness.errors.length, 1);
    assert.match(harness.errors[0], /lease was lost before state was persisted/);
});

test("scheduler single-flight lock skips overlapping runs and unlocks after completion", async () => {
    let releaseFirst: (() => void) | undefined;
    let runs = 0;
    const errors: unknown[] = [];
    const runOnce = createSingleFlightRunner(async () => {
        runs++;
        if (runs === 1) {
            await new Promise<void>(resolve => { releaseFirst = resolve; });
        }
    }, error => errors.push(error));

    const first = runOnce();
    await Promise.resolve();
    await runOnce();
    assert.equal(runs, 1);
    releaseFirst?.();
    await first;
    await runOnce();

    assert.equal(runs, 2);
    assert.deepEqual(errors, []);
});
