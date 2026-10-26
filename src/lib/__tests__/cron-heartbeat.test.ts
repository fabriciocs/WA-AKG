import assert from "node:assert/strict";
import { test } from "node:test";
import { createLeaseHeartbeat } from "@/lib/cron";

const fixedNow = new Date("2026-10-24T12:00:00.000Z");
const models = ["scheduledMessage", "broadcastRecipient", "broadcastLog"] as const;

test("lease heartbeat refreshes the selected delegate and stops each unreferenced timer", async () => {
    const calls: Array<{ model: string; where: { id: string; claimToken: string }; data: { claimedAt: Date } }> = [];
    const timers: Array<{ unref: () => void }> = [];
    const callbacks: Array<() => void> = [];
    const cleared: Array<{ unref: () => void }> = [];
    let unrefCount = 0;
    const delegates = Object.fromEntries(models.map(model => [model, {
        updateMany: async (args: { where: { id: string; claimToken: string }; data: { claimedAt: Date } }) => {
            calls.push({ model, ...args });
        }
    }])) as unknown as Record<(typeof models)[number], {
        updateMany: (args: { where: { id: string; claimToken: string }; data: { claimedAt: Date } }) => Promise<void>;
    }>;

    const heartbeat = createLeaseHeartbeat({
        delegates,
        schedule: (callback, intervalMs) => {
            assert.equal(intervalMs, 200_000);
            callbacks.push(callback);
            const timer = { unref: () => { unrefCount++; } };
            timers.push(timer);
            return timer;
        },
        clear: timer => cleared.push(timer as { unref: () => void }),
        now: () => fixedNow,
        intervalMs: 200_000,
        logError: () => assert.fail("successful heartbeat must not log an error")
    });

    const stop = models.map((model, index) => heartbeat(model, `job-${index}`, `token-${index}`));
    for (const callback of callbacks) callback();
    await Promise.resolve();
    stop.forEach(stopTimer => stopTimer());

    assert.deepEqual(calls, models.map((model, index) => ({
        model,
        where: { id: `job-${index}`, claimToken: `token-${index}` },
        data: { claimedAt: fixedNow }
    })));
    assert.equal(unrefCount, models.length);
    assert.deepEqual(cleared, timers);
});

test("lease heartbeat logs a failed refresh with the claimed row id", async () => {
    const failure = new Error("database unavailable");
    const errors: Array<{ id: string; error: unknown }> = [];
    let callback: (() => void) | undefined;
    const delegates = Object.fromEntries(models.map(model => [model, {
        updateMany: async () => { throw failure; }
    }])) as unknown as Record<(typeof models)[number], {
        updateMany: (args: { where: { id: string; claimToken: string }; data: { claimedAt: Date } }) => Promise<unknown>;
    }>;
    const timer = { unref: () => undefined };
    const heartbeat = createLeaseHeartbeat({
        delegates,
        schedule: next => { callback = next; return timer; },
        clear: () => undefined,
        now: () => fixedNow,
        intervalMs: 200_000,
        logError: (id, error) => errors.push({ id, error })
    });

    const stop = heartbeat("broadcastRecipient", "recipient-1", "lease-1");
    callback?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    stop();

    assert.deepEqual(errors, [{ id: "recipient-1", error: failure }]);
});
