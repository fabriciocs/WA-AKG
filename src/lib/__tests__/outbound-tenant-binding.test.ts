import assert from "node:assert/strict";
import test from "node:test";
import { isValidOutboundTenantBinding } from "../../modules/messaging/outbound-tenant-binding";

const operation = {
    userId: "owner-a", tenantId: "tenant-a",
    sessionDbId: "db-session-a", whatsappSessionId: "public-session-a",
};
const session = {
    id: "db-session-a", userId: "owner-a", tenantId: "tenant-a",
    sessionId: "public-session-a", tenant: { status: "ACTIVE" },
};

test("outbound requires an active matching tenant and owner", () => {
    assert.equal(isValidOutboundTenantBinding(operation, session), true);
});

test("outbound denies another tenant", () => {
    assert.equal(isValidOutboundTenantBinding(operation, { ...session, tenantId: "tenant-b" }), false);
});
test("outbound denies another owner in the same tenant", () => {
    assert.equal(isValidOutboundTenantBinding(operation, { ...session, userId: "owner-c" }), false);
});
test("outbound denies different internal and public sessions", () => {
    assert.equal(isValidOutboundTenantBinding(operation, { ...session, id: "other-db-session" }), false);
    assert.equal(isValidOutboundTenantBinding(operation, { ...session, sessionId: "other-public-session" }), false);
});

test("outbound denies legacy null and suspended tenants before transport", () => {
    assert.equal(isValidOutboundTenantBinding({ ...operation, tenantId: null }, session), false);
    assert.equal(isValidOutboundTenantBinding(operation, { ...session, tenantId: null }), false);
    assert.equal(isValidOutboundTenantBinding(operation, { ...session, tenant: { status: "SUSPENDED" } }), false);
    assert.equal(isValidOutboundTenantBinding(operation, { ...session, tenant: null }), false);
    assert.equal(isValidOutboundTenantBinding(operation, null), false);
});
