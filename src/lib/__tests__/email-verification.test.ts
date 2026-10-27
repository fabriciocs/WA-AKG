import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { prisma } from "../prisma";
import { consumeVerificationToken, isVerificationResendAllowed, sendVerificationEmail } from "../email-verification";

function override(target: object, key: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, value });
  return () => descriptor ? Object.defineProperty(target, key, descriptor) : Reflect.deleteProperty(target, key);
}

test("email verification resends are capped per account per hour and day", () => {
  assert.equal(isVerificationResendAllowed(0, 0), true);
  assert.equal(isVerificationResendAllowed(2, 9), true);
  assert.equal(isVerificationResendAllowed(3, 0), false);
  assert.equal(isVerificationResendAllowed(0, 10), false);
});

test("SMTP sends a one-time verification link with TLS and authentication settings", async () => {
  const tokenDelegate = prisma.emailVerificationToken;
  let stored: { id: string; tokenHash: string; expiresAt: Date } | undefined;
  let mail: { from: string; to: string; subject: string; text: string; html: string } | undefined;
  let transportOptions: unknown;
  const restore = [
    override(tokenDelegate, "count", async () => 0),
    override(tokenDelegate, "create", async (args: { data: { tokenHash: string; expiresAt: Date } }) => {
      stored = { id: "verification-mail", ...args.data };
      return stored;
    }),
  ];
  const env = ["BASE_URL", "OAUTH_ISSUER_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
  const previousEnv = new Map(env.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    BASE_URL: "https://wa-akg.example.test",
    OAUTH_ISSUER_URL: "",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "smtp-password",
    SMTP_FROM: "WA-AKG <no-reply@example.test>",
  });
  const factory = ((options: unknown) => {
    transportOptions = options;
    return { sendMail: async (message: unknown) => { mail = message as typeof mail; } };
  }) as unknown as typeof nodemailer.createTransport;
  try {
    const result = await sendVerificationEmail({ id: "user-1", email: "user@example.test", name: "A <B>" }, new URL("https://untrusted.example.test/api/auth/register"), factory, "/deploy");
    assert.deepEqual(result, { sent: true, limited: false });
    assert.deepEqual(transportOptions, {
      host: "smtp.example.test", port: 465, secure: true,
      auth: { user: "smtp-user", pass: "smtp-password" },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
    assert.ok(mail);
    const link = new URL(mail!.text.match(/https:\/\/[^\s]+/)![0]);
    assert.equal(link.origin, "https://wa-akg.example.test");
    assert.equal(link.pathname, "/deploy/auth/verify-email");
    assert.equal(stored?.tokenHash, createHash("sha256").update(link.searchParams.get("token")!).digest("hex"));
    assert.match(mail!.html, /A &lt;B&gt;/);
    assert.equal(mail!.to, "user@example.test");
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne();
    for (const key of env) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("SMTP delivery failure consumes the generated token so resend can safely recover", async () => {
  const tokenDelegate = prisma.emailVerificationToken;
  let revoked = false;
  const restore = [
    override(tokenDelegate, "count", async () => 0),
    override(tokenDelegate, "create", async () => ({ id: "failed-mail" })),
    override(tokenDelegate, "updateMany", async (args: { where: { id: string }; data: { consumedAt: Date } }) => {
      revoked = args.where.id === "failed-mail" && args.data.consumedAt instanceof Date;
      return { count: revoked ? 1 : 0 };
    }),
  ];
  const env = ["BASE_URL", "OAUTH_ISSUER_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
  const previousEnv = new Map(env.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    BASE_URL: "https://wa-akg.example.test", OAUTH_ISSUER_URL: "",
    SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_SECURE: "false",
    SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "WA-AKG <no-reply@example.test>",
  });
  const factory = (() => ({ sendMail: async () => { throw new Error("SMTP unavailable"); } })) as unknown as typeof nodemailer.createTransport;
  try {
    await assert.rejects(sendVerificationEmail({ id: "user-1", email: "user@example.test", name: null }, new URL("https://wa-akg.example.test/register"), factory));
    assert.equal(revoked, true);
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne();
    for (const key of env) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("confirmation consumes a hashed, unexpired token only after the confirmation call", async () => {
  const token = "A".repeat(43);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record = { id: "verification-1", userId: "user-1", tokenHash, expiresAt: new Date(Date.now() + 60_000), consumedAt: null as Date | null };
  let confirmed = false;
  const tokenDelegate = prisma.emailVerificationToken;
  const userDelegate = prisma.user;
  const restore = [
    override(tokenDelegate, "findUnique", async (args: { where: { tokenHash: string } }) => {
      assert.equal(args.where.tokenHash, tokenHash);
      return record.consumedAt ? null : record;
    }),
    override(tokenDelegate, "updateMany", async (args: { where: { id: string; consumedAt: null } }) => {
      if (record.id !== args.where.id || record.consumedAt) return { count: 0 };
      record.consumedAt = new Date();
      return { count: 1 };
    }),
    override(userDelegate, "updateMany", async (args: { where: { id: string; emailVerified: false } }) => {
      assert.deepEqual(args.where, { id: "user-1", emailVerified: false });
      if (confirmed) return { count: 0 };
      confirmed = true;
      return { count: 1 };
    }),
    override(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  ];
  try {
    assert.equal(await consumeVerificationToken(token), "verified");
    assert.equal(confirmed, true);
    assert.equal(await consumeVerificationToken(token), "invalid");
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne();
  }
});

test("expired and malformed confirmation tokens cannot verify an account", async () => {
  let transactionCalls = 0;
  const tokenDelegate = prisma.emailVerificationToken;
  const restore = [
    override(tokenDelegate, "findUnique", async () => ({
      id: "expired-token", userId: "user-1", expiresAt: new Date(Date.now() - 1), consumedAt: null,
    })),
    override(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionCalls += 1;
      return callback(prisma);
    }),
  ];
  try {
    assert.equal(await consumeVerificationToken("short"), "invalid");
    assert.equal(transactionCalls, 0);
    assert.equal(await consumeVerificationToken("B".repeat(43)), "invalid");
    assert.equal(transactionCalls, 1);
  } finally {
    for (const restoreOne of restore.reverse()) restoreOne();
  }
});
