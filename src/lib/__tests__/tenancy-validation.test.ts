import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTenantCreateInput,
  parseTenantIdHeader,
  parseTenantIdSelector,
} from "../tenancy/validation";

test("tenant input normalizes bounded names and slugs", () => {
  assert.deepEqual(parseTenantCreateInput({
    name: "  Acme   Brasil ",
    slug: " Acme-Brasil ",
  }), { ok: true, value: { name: "Acme Brasil", slug: "acme-brasil" } });
});

test("tenant validation rejects malformed and control-character input", () => {
  assert.equal(parseTenantCreateInput({ name: "Acme", slug: "../admin" }).ok, false);
  assert.equal(parseTenantCreateInput({ name: "Acme", slug: "" }).ok, false);
  assert.equal(parseTenantCreateInput({ name: "\u0000", slug: "acme" }).ok, false);
});

test("tenant selectors fail closed for missing or malformed values", () => {
  assert.equal(parseTenantIdHeader(null), null);
  assert.equal(parseTenantIdHeader(" "), null);
  assert.equal(parseTenantIdHeader("tenant/other"), null);
  assert.equal(parseTenantIdSelector(42), null);
  assert.equal(parseTenantIdSelector({ id: "tenant-1" }), null);
});

test("tenant identifiers must be bounded opaque identifiers", () => {
  assert.equal(parseTenantIdHeader("tenant-1"), "tenant-1");
  assert.equal(parseTenantIdHeader("cuid_123"), "cuid_123");
  assert.equal(parseTenantIdHeader("a".repeat(129)), null);
});
