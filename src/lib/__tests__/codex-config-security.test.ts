import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("tracked Codex profile must never embed a WA-AKG API key", () => {
  const configPath = path.join(process.cwd(), ".codex", "config.toml");
  if (!existsSync(configPath)) return;
  const toml = readFileSync(configPath, "utf8");
  assert.doesNotMatch(toml, /^\s*WA_AKG_API_KEY\s*=/m, "Use a private process environment, not tracked TOML");
});
