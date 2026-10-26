const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function buildDatabaseUrl(env = process.env) {
    const { MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_APP_USER, MYSQL_APP_PASSWORD } = env;
    if ([MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_APP_USER, MYSQL_APP_PASSWORD].some((value) => value === undefined)) {
        if (env.DATABASE_URL) return env.DATABASE_URL;
        throw new Error("Set DATABASE_URL or all MYSQL_APP_* connection variables.");
    }

    const url = new URL("mysql://localhost");
    url.hostname = MYSQL_HOST;
    url.port = MYSQL_PORT;
    url.pathname = `/${MYSQL_DATABASE}`;
    url.username = MYSQL_APP_USER;
    url.password = MYSQL_APP_PASSWORD;
    return url.toString();
}

function commandFor(mode, env = process.env) {
    if (mode === "app") {
        const executable = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
        return [executable, [executable, "src/server/index.ts"]];
    } else if (mode === "migrate") {
        const executable = path.join(root, "node_modules", "prisma", "build", "index.js");
        return [executable, [executable, "migrate", "deploy"]];
    } else if (mode === "baseline") {
        const migration = env.PRISMA_BASELINE_MIGRATION;
        if (!migration || !/^\d{14}_[a-z0-9_]+$/.test(migration)) {
            throw new Error("Set PRISMA_BASELINE_MIGRATION to the exact checked-in migration name after verifying the existing schema.");
        }
        const executable = path.join(root, "node_modules", "prisma", "build", "index.js");
        return [executable, [executable, "migrate", "resolve", "--applied", migration]];
    } else if (mode === "make-admin") {
        if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
            throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD for the one-time administrator setup command.");
        }
        const executable = path.join(root, "scripts", "setup-admin.js");
        return [executable, [executable]];
    } else {
        throw new Error("Usage: node scripts/container-start.js <app|migrate|baseline|make-admin>");
    }
}

function run(mode, env = process.env) {
    const databaseUrl = buildDatabaseUrl(env);
    const [, args] = commandFor(mode, env);
    const child = spawn(process.execPath, args, {
        cwd: root,
        env: { ...env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => child.kill(signal));
    }

    child.on("error", (error) => {
        console.error(`Failed to start container command: ${error.message}`);
        process.exitCode = 1;
    });

    child.on("exit", (code, signal) => {
        process.exitCode = code ?? (signal ? 1 : 0);
    });
}

if (require.main === module) {
    try {
        run(process.argv[2]);
    } catch (error) {
        console.error(error instanceof Error ? error.message : "Container configuration failed.");
        process.exit(1);
    }
}

module.exports = { buildDatabaseUrl, commandFor, run };
