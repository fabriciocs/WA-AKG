import assert from "node:assert/strict";
import test from "node:test";
import { detectConfig, generateSecret, migrateValues, parseEnv, redact, renderEnv, sanitizeOutput, validate } from "./setup.mjs";

const template = "PORT=3000\nDATABASE_URL=mysql://root@localhost/db\nAUTH_SECRET=placeholder\nBASE_URL=http://localhost:3000\nNODE_ENV=development\n";

test("parses env values and redacts credentials", () => {
  assert.equal(parseEnv("PORT=3000\nAUTH_SECRET=secret").PORT, "3000");
  assert.equal(redact("AUTH_SECRET", "secret"), "[redacted]");
  assert.equal(redact("APP_NAME", "WA-AKG"), "WA-AKG");
});

test("detects missing and legacy configurations", () => {
  assert.equal(detectConfig(null, template).state, "missing");
  assert.equal(detectConfig("PORT=3000\n", template).state, "legacy");
});

test("migration preserves existing values and generates missing secret", () => {
  const values = migrateValues({ PORT: "3030", DATABASE_URL: "mysql://example", BASE_URL: "http://localhost:3030", NODE_ENV: "development" }, template);
  assert.equal(values.PORT, "3030");
  assert.equal(values.WA_AKG_SETUP_VERSION, "1");
  assert.ok(values.AUTH_SECRET.length >= 20);
});

test("renders values and validates the resulting configuration", () => {
  const values = migrateValues(parseEnv(template), template);
  assert.match(renderEnv(template, values), /PORT="3000"/);
  assert.deepEqual(validate(values), []);
  assert.ok(validate({ ...values, PORT: "99999" }).length > 0);
});

test("production validation requires production mode and an approved binding", () => {
  const values = migrateValues({ ...parseEnv(template), NODE_ENV: "production", HOSTNAME: "127.0.0.1" }, template);
  assert.deepEqual(validate(values, "production"), []);
  assert.ok(validate({ ...values, NODE_ENV: "development" }, "production").some((error) => error.includes("NODE_ENV")));
  assert.ok(validate({ ...values, HOSTNAME: "0.0.0.0:3000" }, "production").some((error) => error.includes("HOSTNAME")));
});

test("production command output redacts database URLs and secret values", () => {
  const values = { DATABASE_URL: "mysql://user:password@example/db", AUTH_SECRET: "secret-value" };
  const safe = sanitizeOutput("error mysql://user:password@example/db AUTH_SECRET=secret-value", values);
  assert.doesNotMatch(safe, /password|secret-value/);
  assert.match(safe, /redacted/);
});
