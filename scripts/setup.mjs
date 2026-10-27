#!/usr/bin/env node

/**
 * Cross-platform, dependency-free setup wizard for WA-AKG.
 * Run with: node scripts/setup.mjs [--non-interactive] [--mode dev|production|docker]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { spawn } from "node:child_process";
import net from "node:net";

export const SETUP_VERSION = 1;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");
const secretKeys = new Set(["AUTH_SECRET", "SWAGGER_PASSWORD", "MYSQL_ROOT_PASSWORD", "MYSQL_APP_PASSWORD", "ADMIN_PASSWORD", "ENCRYPTION_KEY"]);
const requiredKeys = ["PORT", "DATABASE_URL", "AUTH_SECRET", "BASE_URL", "NODE_ENV"];

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return values;
}

export function redact(key, value) {
  if (!value) return "";
  if (secretKeys.has(key) || /(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)/i.test(key)) return "[redacted]";
  return value;
}

function quote(value) {
  return `"${String(value ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function generateSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function templateKeys(text) {
  return [...new Set(Object.keys(parseEnv(text)))];
}

export function renderEnv(template, values) {
  const seen = new Set();
  const rendered = template.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*?)\s*$/);
    if (!match || values[match[2]] === undefined) return line;
    seen.add(match[2]);
    return `${match[1]}${match[2]}${match[3]}${quote(values[match[2]])}`;
  });
  for (const [key, value] of Object.entries(values)) if (!seen.has(key)) rendered.push(`${key}=${quote(value)}`);
  return `${rendered.join("\n").replace(/\n*$/, "")}\n`;
}

export function detectConfig(text, exampleText) {
  if (text == null) return { state: "missing", values: {}, version: 0 };
  const values = parseEnv(text);
  const version = Number(values.WA_AKG_SETUP_VERSION || 0) || 0;
  const missing = templateKeys(exampleText).filter((key) => values[key] === undefined);
  return { state: version === SETUP_VERSION && missing.length === 0 ? "current" : "legacy", values, version, missing };
}

export function migrateValues(existing, exampleText) {
  const values = { ...parseEnv(exampleText), ...existing, WA_AKG_SETUP_VERSION: String(SETUP_VERSION) };
  if (!values.AUTH_SECRET || /your-super-secret|placeholder/i.test(values.AUTH_SECRET)) values.AUTH_SECRET = generateSecret();
  if (!values.SWAGGER_PASSWORD || values.SWAGGER_PASSWORD.startsWith("replace-with")) values.SWAGGER_PASSWORD = generateSecret();
  if (!values.MYSQL_ROOT_PASSWORD || values.MYSQL_ROOT_PASSWORD.startsWith("change-this")) values.MYSQL_ROOT_PASSWORD = generateSecret(24);
  if (!values.MYSQL_APP_PASSWORD || values.MYSQL_APP_PASSWORD.startsWith("replace-with")) values.MYSQL_APP_PASSWORD = generateSecret(24);
  if (!values.ADMIN_PASSWORD || values.ADMIN_PASSWORD.startsWith("change-this")) values.ADMIN_PASSWORD = generateSecret(24);
  return values;
}

export function validate(values, mode = "dev", platform = process.platform) {
  const errors = [];
  for (const key of requiredKeys) if (!values[key] || /your-super-secret|change-this|replace-with/i.test(values[key])) errors.push(`${key} is missing or still has a placeholder value`);
  if (!/^\d+$/.test(String(values.PORT || "")) || Number(values.PORT) < 1 || Number(values.PORT) > 65535) errors.push("PORT must be between 1 and 65535");
  try { const url = new URL(values.BASE_URL); if (!/^https?:$/.test(url.protocol)) errors.push("BASE_URL must use http or https"); } catch { errors.push("BASE_URL must be a valid URL"); }
  if (mode === "docker" && !fs.existsSync(path.join(root, "docker-compose.yml")) && !fs.existsSync(path.join(root, "compose.yml"))) errors.push("Docker Compose file not found");
  if (mode === "production") {
    if (values.NODE_ENV !== "production") errors.push("NODE_ENV must be production");
    if (!values.HOSTNAME || !["127.0.0.1", "0.0.0.0"].includes(values.HOSTNAME)) errors.push("HOSTNAME must be 127.0.0.1 or 0.0.0.0 in production");
    const migrationsPath = path.join(root, "prisma", "migrations");
    if (!fs.existsSync(migrationsPath) || !fs.readdirSync(migrationsPath).some((entry) => /^\d{14}_[a-z0-9_]+$/.test(entry))) errors.push("Prisma migrations are required for production");
    if (!fs.existsSync(path.join(root, "node_modules"))) errors.push("node_modules is required; install dependencies before production setup");
  }
  if (platform === "win32" && values.MEDIA_STORAGE_PATH?.includes("/")) { /* relative paths are valid on Windows too */ }
  return errors;
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${file}.backup-${stamp}`;
  fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
  return target;
}

function ask(rl, question, fallback = "") { return rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `).then((answer) => answer.trim() || fallback); }
async function askSecret(rl, question, fallback = "") {
  if (!input.isTTY || typeof input.setRawMode !== "function") return ask(rl, `${question} (leave blank to keep/generate)`, fallback);
  output.write(`${question} (leave blank to keep/generate): `);
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (result) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
      resolve(result || fallback);
    };
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === "\u0003") { input.setRawMode(false); input.pause(); reject(new Error("Configuração cancelada.")); return; }
        if (char === "\r" || char === "\n") { finish(value); return; }
        if (char === "\u007f" || char === "\b") { value = value.slice(0, -1); continue; }
        if (char >= " ") value += char;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function configure({ nonInteractive = false, requestedMode, applyMigrations = false } = {}) {
  const template = fs.readFileSync(examplePath, "utf8");
  const existingText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : null;
  const detected = detectConfig(existingText, template);
  let values = migrateValues(detected.values, template);
  const rl = nonInteractive ? null : readline.createInterface({ input, output });
  try {
    let reconfigure = detected.state !== "missing";
    if (rl && reconfigure) reconfigure = (await ask(rl, "Configuração existente/antiga. Reconfigurar? (s/N)", "N")).toLowerCase().startsWith("s");
    if (rl && reconfigure) {
      values.PORT = await ask(rl, "Porta", values.PORT);
      values.BASE_URL = await ask(rl, "URL base", values.BASE_URL);
      values.DATABASE_URL = await ask(rl, "DATABASE_URL", values.DATABASE_URL);
      values.AUTH_SECRET = await askSecret(rl, "AUTH_SECRET", values.AUTH_SECRET);
      values.SWAGGER_PASSWORD = await askSecret(rl, "Senha Swagger", values.SWAGGER_PASSWORD);
      values.NODE_ENV = await ask(rl, "NODE_ENV (development/production)", values.NODE_ENV);
    }
    if (rl && detected.state === "missing") {
      values.PORT = await ask(rl, "Porta", values.PORT === "3000" ? "43000" : values.PORT);
      values.BASE_URL = await ask(rl, "URL base", values.BASE_URL);
      values.DATABASE_URL = await ask(rl, "DATABASE_URL", values.DATABASE_URL);
      values.AUTH_SECRET = await askSecret(rl, "AUTH_SECRET", "");
      values.SWAGGER_PASSWORD = await askSecret(rl, "Senha Swagger", "");
      values.NODE_ENV = await ask(rl, "NODE_ENV (development/production)", "development");
    }
    if (requestedMode === "production") {
      values.HOSTNAME = rl ? await ask(rl, "Binding de rede (127.0.0.1/0.0.0.0)", values.HOSTNAME || "127.0.0.1") : (values.HOSTNAME || "127.0.0.1");
      values.NODE_ENV = "production";
      if (rl && !(await ask(rl, "Executar prisma migrate deploy agora? (s/N)", "N")).toLowerCase().startsWith("s")) {
        throw new Error("Produção exige confirmação explícita para executar prisma migrate deploy.");
      }
      if (nonInteractive && !applyMigrations) throw new Error("Modo não interativo exige --apply-migrations em produção.");
    }
    if (nonInteractive) values.NODE_ENV = values.NODE_ENV || "development";
    const mode = requestedMode || (rl ? await ask(rl, "Modo (dev/production/docker)", "dev") : "dev");
    const errors = validate(values, mode);
    if (errors.length) throw new Error(`Configuração inválida:\n- ${errors.join("\n- ")}`);
    const shouldWrite = detected.state === "missing" || reconfigure || detected.state === "legacy";
    if (shouldWrite) {
      const previous = backup(envPath);
      fs.writeFileSync(envPath, renderEnv(template, values), { encoding: "utf8", mode: 0o600 });
      console.log(previous ? `Backup criado: ${path.basename(previous)}` : "Configuração criada.");
    } else console.log("Configuração atual preservada.");
    return { mode, state: detected.state, envPath, values, applyMigrations: mode === "production" ? (applyMigrations || Boolean(rl)) : false };
  } finally { rl?.close(); }
}

function command(mode) {
  if (mode === "dev") return { file: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", "dev"] };
  if (mode === "production") return { file: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", "build"], then: ["run", "start"] };
  if (mode === "docker") return { file: process.platform === "win32" ? "docker.exe" : "docker", args: ["compose", "up"] };
  throw new Error(`Modo desconhecido: ${mode}`);
}

function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(Number(port), host);
  });
}

async function runProduction(result) {
  if (!(await isPortAvailable(result.values.PORT, result.values.HOSTNAME))) throw new Error(`A porta ${result.values.PORT} não está disponível em ${result.values.HOSTNAME}.`);
  console.log("[1/3] Aplicando migrações Prisma...");
  const migrationCode = await runProcess(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"], result.values);
  if (migrationCode !== 0) throw new Error(`prisma migrate deploy falhou com código ${migrationCode}. O build não foi iniciado.`);
  console.log("[2/3] Construindo bundle de produção...");
  const buildCode = await runProcess(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], result.values);
  if (buildCode !== 0) throw new Error(`npm run build falhou com código ${buildCode}. O servidor não foi iniciado.`);
  console.log("[3/3] Iniciando servidor de produção em foreground...");
  return runProcess(process.platform === "win32" ? "npm.cmd" : "npm", ["start"], result.values);
}

function runProcess(file, args, values) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, stdio: ["inherit", "pipe", "pipe"], shell: false, env: { ...process.env, ...values, NODE_ENV: "production" } });
    const forward = (chunk) => output.write(sanitizeOutput(String(chunk), values));
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("error", (error) => reject(new Error(`Não foi possível executar ${file}: ${error.message}`)));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export function sanitizeOutput(text, values = {}) {
  let safe = text.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[redacted]@");
  for (const key of secretKeys) if (values[key]) safe = safe.split(String(values[key])).join("[redacted]");
  if (values.DATABASE_URL) safe = safe.split(String(values.DATABASE_URL)).join("[redacted]");
  return safe;
}

export function runCommand(mode) {
  const spec = command(mode);
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NODE_ENV: mode === "production" ? "production" : process.env.NODE_ENV };
    const child = spawn(spec.file, spec.args, { cwd: root, stdio: "inherit", shell: false, env });
    child.on("error", (error) => reject(new Error(`Não foi possível executar ${spec.file}: ${error.message}`)));
    child.on("exit", async (code) => {
      if ((code ?? 1) !== 0 || !spec.then) return resolve(code ?? 1);
      try {
        const followUp = spawn(spec.file, spec.then, { cwd: root, stdio: "inherit", shell: false, env });
        followUp.on("error", (error) => reject(new Error(`Não foi possível executar ${spec.file}: ${error.message}`)));
        followUp.on("exit", (followUpCode) => resolve(followUpCode ?? 1));
      } catch (error) { reject(error); }
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const modeIndex = process.argv.findIndex((arg) => arg === "--mode");
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ?? (modeIndex >= 0 ? process.argv[modeIndex + 1] : undefined);
  const applyMigrations = args.has("--apply-migrations");
  try {
    const result = await configure({ nonInteractive: args.has("--non-interactive"), requestedMode: modeArg, applyMigrations });
    if (!args.has("--configure-only")) process.exitCode = result.mode === "production" ? await runProduction(result) : await runCommand(result.mode);
  } catch (error) { console.error(error instanceof Error ? error.message : "Falha ao configurar WA-AKG."); process.exitCode = 1; }
}
