import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectConfig, generateSecret, migrateValues, parseEnv, redact, renderEnv, sanitizeOutput, spawnPortable, validate } from "./setup.mjs";

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

test("spawns npm cross-platform without EINVAL or deprecated shell arguments", async () => {
  const file = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await new Promise((resolve, reject) => {
    const child = spawnPortable(file, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  assert.doesNotMatch(result.stderr, /DEP0190/);
});

test("Windows npx wrapper starts the installed Prisma CLI without EINVAL", { skip: process.platform !== "win32" }, async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawnPortable("npx.cmd", ["--no-install", "prisma", "--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /prisma\s*:\s*\d+\.\d+/i);
  assert.doesNotMatch(result.stderr, /DEP0190/);
});

test("Windows batch command rejects shell metacharacters", { skip: process.platform !== "win32" }, () => {
  assert.throws(() => spawnPortable("npm.cmd", ["--version & echo unsafe"]), /não permitidos/);
});

test("interactive production selection requires migration approval before changing env", { timeout: 12000 }, async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "wa-akg-setup-"));
  try {
    const scriptsDir = path.join(fixture, "scripts");
    fs.mkdirSync(scriptsDir);
    fs.copyFileSync(new URL("./setup.mjs", import.meta.url), path.join(scriptsDir, "setup.mjs"));
    const initialEnv = template.replace("AUTH_SECRET=placeholder", "AUTH_SECRET=synthetic-test-secret") + "WA_AKG_SETUP_VERSION=1\n";
    const testEnv = path.join(fixture, ".env");
    fs.writeFileSync(testEnv, initialEnv);
    fs.writeFileSync(path.join(fixture, ".env.example"), initialEnv);
    const prompts = ["Reconfigurar?", "Modo (dev/production/docker)", "Binding de rede", "Executar prisma migrate deploy agora?"];
    const answers = ["N", "production", "", "N"];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(scriptsDir, "setup.mjs"), "--configure-only"], {
        cwd: fixture, stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let answered = 0;
      const watchdog = setTimeout(() => child.kill(), 8000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (answered < prompts.length && stdout.includes(prompts[answered])) {
          child.stdin.write(answers[answered] + "\n");
          answered++;
        }
      });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => { clearTimeout(watchdog); reject(error); });
      child.on("close", (code) => { clearTimeout(watchdog); resolve({ code, stderr, answered }); });
    });
    assert.equal(result.answered, 4);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Produção exige confirmação explícita/);
    assert.equal(fs.readFileSync(testEnv, "utf8"), initialEnv);
    assert.deepEqual(fs.readdirSync(fixture).filter((name) => name.startsWith(".env.backup")), []);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
