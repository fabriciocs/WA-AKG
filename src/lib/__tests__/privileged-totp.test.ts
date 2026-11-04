import assert from "node:assert/strict";
import test from "node:test";
import { adminTotpClaimId, verifyAdminTotp } from "../tenancy/privileged-totp";

const rfcTestSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("admin TOTP accepts the RFC 6238 SHA-1 vector truncated to six digits", () => {
  assert.equal(verifyAdminTotp(rfcTestSecret, "287082", 59_000), 1);
  assert.equal(verifyAdminTotp(rfcTestSecret, "287082", 60_000), 1);
  assert.equal(verifyAdminTotp(rfcTestSecret, "287082", 90_000), null);
});

test("admin TOTP rejects malformed enrollment and incorrect codes", () => {
  assert.equal(verifyAdminTotp(rfcTestSecret, "123456", 59_000), null);
  assert.equal(verifyAdminTotp(rfcTestSecret, "94287082", 59_000), null);
  assert.equal(verifyAdminTotp("BAD-KEY", "287082", 59_000), null);
});

test("one admin claim is deterministic across replicas and separates actors and steps", () => {
  assert.equal(adminTotpClaimId("admin", 1), adminTotpClaimId("admin", 1));
  assert.notEqual(adminTotpClaimId("admin", 1), adminTotpClaimId("other", 1));
  assert.notEqual(adminTotpClaimId("admin", 1), adminTotpClaimId("admin", 2));
});
