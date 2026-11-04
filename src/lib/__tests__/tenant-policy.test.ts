import test from "node:test";
import assert from "node:assert/strict";
import {
  canManageTenant,
  decideTenantAccess,
  type TenantActor,
  type TenantPolicyInput,
  type TenantResource,
} from "../tenant-policy";

// Keep this suite aligned with the repository's node:test runner while making
// the assertions below easy to scan as policy cases.
const describe = test;
const it = test;
function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      assert.equal(actual, expected);
    },
    toEqual(expected: unknown) {
      assert.deepEqual(actual, expected);
    },
    not: {
      toContain(expected: string) {
        assert.equal(
          typeof actual === "string" && actual.includes(expected),
          false,
        );
      },
    },
  };
}

const baseActor: TenantActor = {
  userId: "user-1",
  tenantId: "tenant-a",
  platformRole: "USER",
  tenantRole: "MEMBER",
  membershipStatus: "ACTIVE",
  authMethod: "session",
};

const sharedResource: TenantResource = {
  tenantId: "tenant-a",
  ownerUserId: "owner-1",
  visibility: "TENANT_SHARED",
};

function makeInput(
  overrides: Partial<TenantPolicyInput> = {},
): TenantPolicyInput {
  return {
    actor: { ...baseActor, ...(overrides.actor ?? {}) },
    resource: { ...sharedResource, ...(overrides.resource ?? {}) },
    action: "READ",
    now: "2026-11-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("decideTenantAccess", () => {
  it("denies missing identity without disclosing resource details", () => {
    const decision = decideTenantAccess(
      makeInput({ actor: { ...baseActor, userId: null } }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: identity required");
    expect(decision.reason).not.toContain("tenant-a");
  });

  it("denies cross-tenant resource access", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: { ...baseActor, tenantId: "tenant-b" },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: tenant context mismatch");
  });

  it("denies a missing tenant context closed", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: { ...baseActor, tenantId: null },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: tenant context required");
  });

  it("denies revoked membership even for a same-tenant shared resource", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: { ...baseActor, membershipStatus: "REVOKED" },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: active membership required");
  });

  it("denies API credentials that are scoped to another tenant", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: { ...baseActor, authMethod: "apiKey" },
        credentialTenantId: "tenant-b",
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: credential tenant mismatch");
  });

  it("requires a tenant-bound credential for OAuth, MCP, and worker access", () => {
    for (const authMethod of ["oauth", "mcp", "worker"] as const) {
      const decision = decideTenantAccess(
        makeInput({ actor: { ...baseActor, authMethod } }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("Access denied: credential tenant mismatch");
    }
  });

  it("does not let a tenant admin read another user's private resource", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: { ...baseActor, tenantRole: "ADMIN" },
        resource: { ...sharedResource, visibility: "PRIVATE" },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: resource access denied");
  });

  it("allows the private resource owner without elevating tenant privileges", () => {
    const decision = decideTenantAccess(
      makeInput({
        resource: {
          ...sharedResource,
          ownerUserId: "user-1",
          visibility: "PRIVATE",
        },
        action: "WRITE",
      }),
    );

    expect(decision).toEqual({ allowed: true, reason: "Access granted" });
  });

  it("denies expired grants", () => {
    const decision = decideTenantAccess(
      makeInput({
        resource: {
          ...sharedResource,
          visibility: "EXPLICIT_GRANT",
          grants: [
            {
              userId: "user-1",
              capabilities: ["READ"],
              expiresAt: "2026-11-03T11:59:59.999Z",
            },
          ],
        },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: resource access denied");
  });

  it("denies revoked grants and grants with invalid expiry timestamps", () => {
    for (const grant of [
      {
        userId: "user-1",
        capabilities: ["READ"],
        revokedAt: "2026-11-02T12:00:00.000Z",
      },
      {
        userId: "user-1",
        capabilities: ["READ"],
        expiresAt: "not-a-timestamp",
      },
    ]) {
      const decision = decideTenantAccess(
        makeInput({
          resource: {
            ...sharedResource,
            visibility: "EXPLICIT_GRANT",
            grants: [grant],
          },
        }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("Access denied: resource access denied");
    }
  });

  it("requires the grant capability for the requested action", () => {
    const decision = decideTenantAccess(
      makeInput({
        action: "WRITE",
        resource: {
          ...sharedResource,
          visibility: "EXPLICIT_GRANT",
          grants: [
            {
              userId: "user-1",
              capabilities: ["READ"],
              expiresAt: "2026-11-04T12:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: resource access denied");
  });

  it("allows a same-tenant, unexpired, capability-matching grant", () => {
    const decision = decideTenantAccess(
      makeInput({
        resource: {
          ...sharedResource,
          visibility: "EXPLICIT_GRANT",
          grants: [
            {
              userId: "user-1",
              capabilities: ["READ"],
              expiresAt: "2026-11-04T12:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(decision).toEqual({ allowed: true, reason: "Access granted" });
  });

  it("denies missing required scopes before any role-based allow", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: { ...baseActor, tenantRole: "ADMIN", authMethod: "oauth" },
        credentialTenantId: "tenant-a",
        requiredScopes: ["tenant:write"],
        scopes: ["tenant:read"],
        action: "WRITE",
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: required scope missing");
  });

  it("does not let a member manage the tenant through a resource action", () => {
    const decision = decideTenantAccess(
      makeInput({
        action: "MANAGE_TENANT",
        resource: { ...sharedResource, visibility: "TENANT_SHARED" },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: resource access denied");
  });

  it("allows an active tenant admin to manage the selected tenant", () => {
    const decision = decideTenantAccess(
      makeInput({
        action: "MANAGE_TENANT",
        actor: { ...baseActor, tenantRole: "ADMIN" },
        resource: { ...sharedResource, visibility: "TENANT_SHARED" },
      }),
    );

    expect(decision).toEqual({ allowed: true, reason: "Access granted" });
  });

  it("denies SUPERADMIN role access without privileged access evidence", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: { ...baseActor, platformRole: "SUPERADMIN" },
        resource: { ...sharedResource, visibility: "PRIVATE" },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: resource access denied");
  });

  it("denies elevated access when MFA, audit readiness, reason, or request id is incomplete", () => {
    const incompleteAccess = [
      {
        mfaVerified: false,
        reason: "break glass",
        requestId: "req-1",
        auditReady: true,
      },
      {
        mfaVerified: true,
        reason: " ",
        requestId: "req-1",
        auditReady: true,
      },
      {
        mfaVerified: true,
        reason: "break glass",
        requestId: "",
        auditReady: true,
      },
      {
        mfaVerified: true,
        reason: "break glass",
        requestId: "req-1",
        auditReady: false,
      },
    ];

    for (const privilegedAccess of incompleteAccess) {
      const decision = decideTenantAccess(
        makeInput({
          actor: { ...baseActor, platformRole: "SUPERADMIN" },
          privilegedAccess,
        }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe(
        "Access denied: privileged access validation failed",
      );
    }
  });

  it("keeps credential scope checks in the privileged path", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: {
          ...baseActor,
          platformRole: "SUPERADMIN",
          authMethod: "apiKey",
        },
        credentialTenantId: "tenant-a",
        requiredScopes: ["tenant:manage"],
        scopes: ["tenant:read"],
        privilegedAccess: {
          mfaVerified: true,
          reason: "approved support action",
          requestId: "req-1",
          auditReady: true,
        },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: required scope missing");
  });

  it("rejects elevated tenant impersonation when selected and resource tenants differ", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: {
          ...baseActor,
          tenantId: "tenant-b",
          platformRole: "SUPERADMIN",
        },
        privilegedAccess: {
          mfaVerified: true,
          reason: "approved support action",
          requestId: "req-1",
          auditReady: true,
        },
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("Access denied: tenant context mismatch");
  });

  it("does not allow STAFF or PLATFORM_SUPPORT to use privileged evidence as a bypass", () => {
    for (const platformRole of ["STAFF", "PLATFORM_SUPPORT"] as const) {
      const decision = decideTenantAccess(
        makeInput({
          actor: { ...baseActor, platformRole, tenantRole: "ADMIN" },
          resource: { ...sharedResource, visibility: "PRIVATE" },
          privilegedAccess: {
            mfaVerified: true,
            reason: "approved support action",
            requestId: "req-1",
            auditReady: true,
          },
        }),
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("Access denied: resource access denied");
    }
  });

  it("allows an explicitly selected tenant to a fully audited SUPERADMIN", () => {
    const decision = decideTenantAccess(
      makeInput({
        actor: { ...baseActor, platformRole: "SUPERADMIN" },
        resource: { ...sharedResource, visibility: "PRIVATE" },
        privilegedAccess: {
          mfaVerified: true,
          reason: "approved support action",
          requestId: "req-1",
          auditReady: true,
        },
      }),
    );

    expect(decision).toEqual({ allowed: true, reason: "Access granted" });
  });
});

describe("canManageTenant", () => {
  it("allows only active owners and admins to manage a tenant", () => {
    expect(
      canManageTenant({ ...baseActor, tenantRole: "OWNER" }),
    ).toBe(true);
    expect(
      canManageTenant({ ...baseActor, tenantRole: "ADMIN" }),
    ).toBe(true);
    expect(
      canManageTenant({ ...baseActor, tenantRole: "ADMIN", membershipStatus: "SUSPENDED" }),
    ).toBe(false);
    expect(
      canManageTenant({ ...baseActor, tenantRole: "MEMBER" }),
    ).toBe(false);
  });

  it("keeps tenant deletion and ownership changes owner-only", () => {
    const admin = { ...baseActor, tenantRole: "ADMIN" as const };
    const owner = { ...baseActor, tenantRole: "OWNER" as const };

    expect(canManageTenant(admin, "DELETE")).toBe(false);
    expect(canManageTenant(admin, "CHANGE_OWNERSHIP")).toBe(false);
    expect(canManageTenant(owner, "DELETE")).toBe(true);
    expect(canManageTenant(owner, "CHANGE_OWNERSHIP")).toBe(true);
  });
});

test("privileged SUPERADMIN may audit another tenant without membership", () => {
  const decision = decideTenantAccess({
    actor: {
      userId: "root",
      tenantId: "tenant-b",
      platformRole: "SUPERADMIN",
      tenantRole: null,
      membershipStatus: null,
      authMethod: "session",
    },
    resource: { tenantId: "tenant-b", ownerUserId: "someone-else", visibility: "PRIVATE" },
    action: "READ",
    privilegedAccess: {
      mfaVerified: true,
      reason: "Authorized support investigation",
      requestId: "request-123",
      auditReady: true,
    },
  });
  assert.equal(decision.allowed, true);
});

test("SUPERADMIN privileged access never transfers to OAuth bearer credentials", () => {
  const decision = decideTenantAccess({
    actor: {
      userId: "root",
      tenantId: "tenant-b",
      platformRole: "SUPERADMIN",
      tenantRole: null,
      membershipStatus: null,
      authMethod: "oauth",
    },
    resource: { tenantId: "tenant-b", ownerUserId: "someone-else", visibility: "PRIVATE" },
    action: "READ",
    credentialTenantId: "tenant-b",
    requiredScopes: ["api:read"],
    scopes: ["api:read"],
    privilegedAccess: {
      mfaVerified: true,
      reason: "Authorized support investigation",
      requestId: "request-123",
      auditReady: true,
    },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "Access denied: privileged session required");
});

test("SUPERADMIN without elevated context obeys normal resource ownership", () => {
  const decision = decideTenantAccess({
    actor: {
      userId: "root",
      tenantId: "tenant-a",
      platformRole: "SUPERADMIN",
      tenantRole: "MEMBER",
      membershipStatus: "ACTIVE",
      authMethod: "session",
    },
    resource: { tenantId: "tenant-a", ownerUserId: "root", visibility: "PRIVATE" },
    action: "READ",
  });
  assert.equal(decision.allowed, true);
});
