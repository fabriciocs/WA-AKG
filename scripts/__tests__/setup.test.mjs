import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SETUP_VERSION,
  detectConfig,
  generateSecret,
  migrateValues,
  parseEnv,
  redact,
  renderEnv,
} from "../setup.mjs";

const example = [
  "WA_AKG_SETUP_VERSION=",
  "PORT=3030",
  "DATABASE_URL=",
  "AUTH_SECRET=your-super-secret",
  "BASE_URL=http://localhost:3030",
  "NODE_ENV=development",
].join("\n");

test("detects a missing configuration", () => {
  assert.deepEqual(detectConfig(null, example), {
    state: "missing",
    values: {},
    version: 0,
  });
});

test("detects current and legacy configuration versions", () => {
  const current = renderEnv(example, {
    WA_AKG_SETUP_VERSION: String(SETUP_VERSION),
    PORT: "3030",
    DATABASE_URL: "file:./dev.db",
    AUTH_SECRET: "existing-secret",
    BASE_URL: "http://localhost:3030",
    NODE_ENV: "development",
  });
  assert.equal(detectConfig(current, example).state, "current");

  const legacy = renderEnv(example, {
    WA_AKG_SETUP_VERSION: String(SETUP_VERSION - 1),
    PORT: "3030",
    DATABASE_URL: "file:./dev.db",
    AUTH_SECRET: "existing-secret",
    BASE_URL: "http://localhost:3030",
    NODE_ENV: "development",
  });
  assert.equal(detectConfig(legacy, example).state, "legacy");
  assert.equal(detectConfig(legacy, example).version, SETUP_VERSION - 1);
});

test("migration preserves existing values and fills new/default secrets", () => {
  const existing = parseEnv([
    "PORT=4040",
    "DATABASE_URL=file:./custom.db",
    "AUTH_SECRET=keep-this-secret",
    "BASE_URL=https://wa.example.test",
    "NODE_ENV=production",
  ].join("\n"));

  const migrated = migrateValues(existing, example);
  assert.equal(migrated.PORT, "4040");
  assert.equal(migrated.DATABASE_URL, "file:./custom.db");
  assert.equal(migrated.AUTH_SECRET, "keep-this-secret");
  assert.equal(migrated.BASE_URL, "https://wa.example.test");
  assert.equal(migrated.WA_AKG_SETUP_VERSION, String(SETUP_VERSION));
  assert.notEqual(migrated.SWAGGER_PASSWORD, undefined);
});

test("redacts secrets while leaving non-sensitive values readable", () => {
  assert.equal(redact("AUTH_SECRET", "sentinel-secret"), "[redacted]");
  assert.equal(redact("THIRD_PARTY_API_KEY", "sentinel-key"), "[redacted]");
  assert.equal(redact("PORT", "3030"), "3030");
  assert.equal(redact("AUTH_SECRET", ""), "");
});

test("generates non-placeholder secrets with sufficient entropy", () => {
  const first = generateSecret();
  const second = generateSecret();
  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.ok(first.length >= 40);
  assert.notEqual(first, second);
});

test("backup contract uses an exclusive timestamped copy", () => {
  const setupSource = fs.readFileSync(path.resolve("scripts/setup.mjs"), "utf8");
  assert.match(setupSource, /const target = `\$\{file\}\.backup-\$\{stamp\}`/);
  assert.match(setupSource, /copyFileSync\(file, target, fs\.constants\.COPYFILE_EXCL\)/);
  assert.match(setupSource, /const previous = backup\(envPath\)/);
});

test("backup filename contract is safe for a temporary path", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-akg-setup-test-"));
  const source = path.join(tempDir, ".env");
  const backup = `${source}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.writeFileSync(source, "AUTH_SECRET=sentinel\n", "utf8");
  fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
  assert.equal(fs.readFileSync(backup, "utf8"), "AUTH_SECRET=sentinel\n");
  fs.rmSync(tempDir, { recursive: true, force: true });
});
