import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createRequire } from "node:module";

const loadCommonJs = createRequire(path.join(process.cwd(), "package.json"));
const { buildDatabaseUrl, commandFor } = loadCommonJs("./scripts/container-start.js") as {
    buildDatabaseUrl: (env?: Record<string, string | undefined>) => string;
    commandFor: (mode: string, env?: Record<string, string | undefined>) => [string, string[]];
};

test("container database URL percent-encodes credentials", () => {
    const url = new URL(buildDatabaseUrl({
        MYSQL_HOST: "db",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: "wa_akg",
        MYSQL_APP_USER: "wa app",
        MYSQL_APP_PASSWORD: "p@ss:/#?",
    }));

    assert.equal(url.hostname, "db");
    assert.equal(url.pathname, "/wa_akg");
    assert.equal(url.username, "wa%20app");
    assert.equal(url.password, "p%40ss%3A%2F%23%3F");
});

test("container database URL requires complete config or an explicit URL", () => {
    assert.throws(() => buildDatabaseUrl({}), /Set DATABASE_URL/);
    assert.equal(buildDatabaseUrl({ DATABASE_URL: "mysql://user:pass@db:3306/wa_akg" }), "mysql://user:pass@db:3306/wa_akg");
});

test("admin setup credentials are passed through environment, not command arguments", () => {
    const [, args] = commandFor("make-admin", { ADMIN_EMAIL: "admin@example.test", ADMIN_PASSWORD: "test-only-password" });
    assert.equal(args.length, 1);
    assert.equal(args.some((arg) => arg.includes("test-only-password")), false);
    assert.throws(() => commandFor("make-admin", {}), /ADMIN_EMAIL and ADMIN_PASSWORD/);
});

test("schema baseline requires a checked-in migration identifier", () => {
    assert.throws(() => commandFor("baseline", {}), /exact checked-in migration name/);
    const [, args] = commandFor("baseline", { PRISMA_BASELINE_MIGRATION: "20261024000000_baseline" });
    assert.deepEqual(args.slice(1), ["migrate", "resolve", "--applied", "20261024000000_baseline"]);
    assert.throws(() => commandFor("baseline", { PRISMA_BASELINE_MIGRATION: "../../anything" }), /exact checked-in migration name/);
});
