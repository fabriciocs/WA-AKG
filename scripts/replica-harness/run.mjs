import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const targetIndex = process.argv.indexOf("--target");
const targetRepo = path.resolve(targetIndex >= 0 ? process.argv[targetIndex + 1] : process.env.WA_AKG_HARNESS_TARGET_REPO || path.resolve(harnessRoot, "..", "WA-AKG"));
const childScript = path.join(harnessRoot, "scripts", "replica-harness", "replica-child.mjs");
const publicOrigin = "https://replica-harness.invalid";
const resource = `${publicOrigin}/wa-akg/mcp`;
const tokens = { userA: "harness-token-user-a-read", userB: "harness-token-user-b-read", userC: "harness-token-user-c-read", wrongAudience: "harness-token-user-a-wrong-audience" };

async function request(url, options = {}) { const response = await fetch(url, options); return { response, text: await response.text() }; }
function body(id, method, params = {}) { return JSON.stringify({ jsonrpc: "2.0", id, method, params }); }
async function initialize(base, token, name) {
  const result = await request(`${base}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: body(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name, version: "deterministic-harness" } }) });
  assert.equal(result.response.status, 200, result.text);
  const sessionId = result.response.headers.get("mcp-session-id");
  assert.ok(sessionId, "initialize must return Mcp-Session-Id");
  return { ...result, sessionId };
}
async function call(base, token, sessionId, id, method, params = {}) { return request(`${base}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Mcp-Session-Id": sessionId, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: body(id, method, params) }); }
function start(replicaId) {
  const child = spawn(process.execPath, [childScript], { cwd: harnessRoot, env: { ...process.env, WA_AKG_HARNESS_TARGET_REPO: targetRepo, HARNESS_REPLICA_ID: replicaId, HARNESS_RESOURCE: resource, HARNESS_MCP_PORT: "0", HARNESS_API_PORT: "0", NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk).slice(-4000); });
  return { child, stderr: () => stderr };
}
async function ready(replica) {
  const lines = createInterface({ input: replica.child.stdout });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`replica did not become ready: ${replica.stderr()}`)), 10_000);
    lines.on("line", line => { try { const value = JSON.parse(line); if (value.kind === "ready") { clearTimeout(timer); resolve(value); } } catch { /* ignore non-JSON child output */ } });
  });
  return { ...result, lines };
}
async function stop(replica) {
  if (replica.child.exitCode !== null || replica.child.signalCode !== null) return;
  const exited = once(replica.child, "exit"); replica.child.kill("SIGTERM");
  try { await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("replica did not stop")), 3000))]); }
  catch { replica.child.kill(); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1000))]); }
}

async function main() {
  const first = start("replica-a"); const second = start("replica-b"); let firstReady; let secondReady;
  try {
    firstReady = await ready(first); secondReady = await ready(second);
    const firstBase = `http://127.0.0.1:${firstReady.port}`; const secondBase = `http://127.0.0.1:${secondReady.port}`;
    const unauthenticated = await request(`${firstBase}/mcp`); assert.equal(unauthenticated.response.status, 401);
    const wrong = await request(`${firstBase}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${tokens.wrongAudience}`, "Content-Type": "application/json" }, body: body(1, "initialize") }); assert.equal(wrong.response.status, 401, wrong.text);
    const firstSession = await initialize(firstBase, tokens.userA, "user-a-a");
    const listed = await call(firstBase, tokens.userA, firstSession.sessionId, 2, "tools/list"); assert.equal(listed.response.status, 200, listed.text);
    const crossReplica = await call(secondBase, tokens.userA, firstSession.sessionId, 3, "tools/list"); assert.equal(crossReplica.response.status, 404, crossReplica.text);
    const crossUser = await call(firstBase, tokens.userB, firstSession.sessionId, 4, "tools/list"); assert.equal(crossUser.response.status, 403, crossUser.text);
    const secondSession = await initialize(secondBase, tokens.userA, "user-a-b"); assert.notEqual(secondSession.sessionId, firstSession.sessionId);
    const userBSession = await initialize(secondBase, tokens.userB, "user-b-b");
    const userCSession = await initialize(firstBase, tokens.userC, "user-c-a");
    const sameTenantCrossUser = await call(firstBase, tokens.userC, firstSession.sessionId, 7, "tools/list"); assert.equal(sameTenantCrossUser.response.status, 403, sameTenantCrossUser.text);
    const sessionsA = await call(firstBase, tokens.userA, firstSession.sessionId, 5, "tools/call", { name: "wa_akg_get_sessions", arguments: {} }); assert.match(sessionsA.text, /synthetic-session-a/); assert.doesNotMatch(sessionsA.text, /synthetic-session-b/);
    const sessionsB = await call(secondBase, tokens.userB, userBSession.sessionId, 6, "tools/call", { name: "wa_akg_get_sessions", arguments: {} }); assert.match(sessionsB.text, /synthetic-session-b/); assert.doesNotMatch(sessionsB.text, /synthetic-session-a/);
    const sessionsC = await call(firstBase, tokens.userC, userCSession.sessionId, 8, "tools/call", { name: "wa_akg_get_sessions", arguments: {} }); assert.match(sessionsC.text, /synthetic-session-c/); assert.doesNotMatch(sessionsC.text, /synthetic-session-a|synthetic-session-b/);
    const stateA = await request(`${firstBase}/__harness/state`); const stateB = await request(`${secondBase}/__harness/state`); assert.equal(JSON.parse(stateA.text).createSessionRequests, 0); assert.equal(JSON.parse(stateB.text).createSessionRequests, 0);
    process.stdout.write(JSON.stringify({ status: "TESTED", scope: "two-process-mcp-http", targetRepo, checks: { bearerAuth: "pass", strictAudience: "pass", userIsolation: "pass", replicaAffinity: "pass", noImplicitSessionCreation: "pass", syntheticBackendOnly: "pass" }, limitation: "Does not prove two full Next/Socket.IO/Baileys replicas." }, null, 2) + "\n");
  } finally { firstReady?.lines.close(); secondReady?.lines.close(); await Promise.allSettled([stop(first), stop(second)]); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
