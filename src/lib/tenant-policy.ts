export type PlatformRole =
  | "SUPERADMIN"
  | "STAFF"
  | "USER"
  | "PLATFORM_SUPPORT";

export type TenantRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null;

export type MembershipStatus =
  | "ACTIVE"
  | "REVOKED"
  | "SUSPENDED"
  | "INVITED"
  | null;

export type AuthMethod = "session" | "apiKey" | "oauth" | "mcp" | "worker";

export type TenantAction =
  | "READ"
  | "WRITE"
  | "MANAGE"
  | "DELETE"
  | "MANAGE_TENANT";

export type ResourceVisibility =
  | "PRIVATE"
  | "TENANT_SHARED"
  | "EXPLICIT_GRANT";

export type TenantManagementOperation =
  | "MANAGE"
  | "DELETE"
  | "CHANGE_OWNERSHIP";

export interface TenantActor {
  userId: string | null;
  tenantId: string | null;
  platformRole: PlatformRole;
  tenantRole: TenantRole;
  membershipStatus: MembershipStatus;
  authMethod: AuthMethod;
}

export interface TenantGrant {
  userId: string;
  capabilities: readonly string[];
  expiresAt?: string | number | Date | null;
  revokedAt?: string | number | Date | null;
}

export interface TenantResource {
  tenantId: string | null;
  ownerUserId?: string | null;
  visibility?: ResourceVisibility;
  grants?: readonly TenantGrant[];
}

export interface PrivilegedAccess {
  mfaVerified: boolean;
  reason: string;
  requestId: string;
  auditReady: boolean;
}

export interface TenantPolicyInput {
  actor: TenantActor;
  resource: TenantResource;
  action: TenantAction;
  credentialTenantId?: string | null;
  scopes?: readonly string[];
  requiredScopes?: readonly string[];
  privilegedAccess?: PrivilegedAccess | null;
  /** Injectable evaluation time keeps grant-expiry decisions deterministic in tests. */
  now?: string | number | Date;
}

export interface TenantPolicyDecision {
  allowed: boolean;
  reason: string;
}

// Keep denial messages generic so callers cannot use this policy as a
// resource-existence oracle.

const deny = (reason: string): TenantPolicyDecision => ({
  allowed: false,
  reason: `Access denied: ${reason}`,
});

const allow = (): TenantPolicyDecision => ({
  allowed: true,
  reason: "Access granted",
});

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toTimestamp(value: string | number | Date): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isGrantUsable(
  grant: TenantGrant,
  actor: TenantActor,
  action: TenantAction,
  now: number,
): boolean {
  if (grant.userId !== actor.userId || !grant.capabilities.includes(action)) {
    return false;
  }

  if (grant.revokedAt !== undefined && grant.revokedAt !== null) {
    return false;
  }

  if (grant.expiresAt === undefined || grant.expiresAt === null) {
    return true;
  }

  const expiresAt = toTimestamp(grant.expiresAt);
  return expiresAt !== null && now < expiresAt;
}

function hasUsableGrant(input: TenantPolicyInput, now: number): boolean {
  // Grants are evaluated only after actor.tenantId and resource.tenantId have
  // matched in decideTenantAccess, so a grant cannot bridge tenant contexts.
  return (input.resource.grants ?? []).some((grant) =>
    isGrantUsable(grant, input.actor, input.action, now),
  );
}

function hasRequiredScopes(input: TenantPolicyInput): boolean {
  const requiredScopes = input.requiredScopes ?? [];
  const scopes = new Set(input.scopes ?? []);
  return requiredScopes.every(
    (requiredScope) => isNonEmpty(requiredScope) && scopes.has(requiredScope),
  );
}

function hasValidPrivilegedAccess(
  privilegedAccess: PrivilegedAccess | null | undefined,
): boolean {
  return (
    privilegedAccess?.mfaVerified === true &&
    privilegedAccess.auditReady === true &&
    isNonEmpty(privilegedAccess.reason) &&
    isNonEmpty(privilegedAccess.requestId)
  );
}

function roleAllowsAction(actor: TenantActor, action: TenantAction): boolean {
  switch (action) {
    case "READ":
      return ["OWNER", "ADMIN", "MEMBER", "VIEWER"].includes(
        actor.tenantRole ?? "",
      );
    case "WRITE":
      return ["OWNER", "ADMIN", "MEMBER"].includes(actor.tenantRole ?? "");
    case "MANAGE":
      return ["OWNER", "ADMIN"].includes(actor.tenantRole ?? "");
    case "DELETE":
      return actor.tenantRole === "OWNER";
    case "MANAGE_TENANT":
      return canManageTenant(actor);
  }
}

/**
 * Returns whether an active tenant owner/admin may manage the tenant.
 * Deleting a tenant or changing ownership is intentionally owner-only.
 */
export function canManageTenant(
  actor: TenantActor,
  operation: TenantManagementOperation = "MANAGE",
): boolean {
  if (
    !isNonEmpty(actor.userId) ||
    !isNonEmpty(actor.tenantId) ||
    actor.membershipStatus !== "ACTIVE"
  ) {
    return false;
  }

  if (operation === "DELETE" || operation === "CHANGE_OWNERSHIP") {
    return actor.tenantRole === "OWNER";
  }

  return actor.tenantRole === "OWNER" || actor.tenantRole === "ADMIN";
}

/**
 * Pure, fail-closed tenant authorization decision logic.
 *
 * This function deliberately does not perform logging, auditing, database
 * lookups, or route enforcement. Callers must enforce the returned decision
 * and separately persist the privileged-access audit record.
 */
export function decideTenantAccess(
  input: TenantPolicyInput,
): TenantPolicyDecision {
  const { actor, resource } = input;

  if (!isNonEmpty(actor.userId)) {
    return deny("identity required");
  }

  if (!isNonEmpty(actor.tenantId) || !isNonEmpty(resource.tenantId)) {
    return deny("tenant context required");
  }

  if (actor.tenantId !== resource.tenantId) {
    return deny("tenant context mismatch");
  }

  const credentialRequired = actor.authMethod !== "session";
  if (
    (credentialRequired && input.credentialTenantId !== resource.tenantId) ||
    (input.credentialTenantId !== undefined &&
      input.credentialTenantId !== null &&
      input.credentialTenantId !== resource.tenantId)
  ) {
    return deny("credential tenant mismatch");
  }

  // Service and bearer credentials must declare an operation-specific scope
  // requirement; an omitted scope contract may never default to allow.
  if (credentialRequired && (!input.requiredScopes || input.requiredScopes.length === 0)) {
    return deny("required scope missing");
  }
  if (!hasRequiredScopes(input)) {
    return deny("required scope missing");
  }

  const now = toTimestamp(input.now ?? Date.now());
  if (now === null) {
    return deny("invalid authorization time");
  }

  // Global administration is an explicit, separately audited browser-session
  // operation. It does not require a membership in the target tenant.
  // Bearer credentials, MCP transports and workers never enter this path.
  if (actor.platformRole === "SUPERADMIN" && input.privilegedAccess) {
    if (actor.authMethod !== "session") {
      return deny("privileged session required");
    }
    if (!hasValidPrivilegedAccess(input.privilegedAccess)) {
      return deny("privileged access validation failed");
    }
    return allow();
  }

  // Even a SUPERADMIN must satisfy ordinary tenant membership and resource
  // privacy rules when not using the explicit privileged administrative flow.
  if (actor.membershipStatus !== "ACTIVE") {
    return deny("active membership required");
  }

  // STAFF and PLATFORM_SUPPORT never enter the global/elevated path.
  const isResourceOwner =
    isNonEmpty(resource.ownerUserId) && resource.ownerUserId === actor.userId;
  const visibility = resource.visibility ?? "PRIVATE";

  if (visibility === "PRIVATE" || visibility === "EXPLICIT_GRANT") {
    if (!isResourceOwner && !hasUsableGrant(input, now)) {
      return deny("resource access denied");
    }
  }

  if (isResourceOwner && input.action !== "MANAGE_TENANT") {
    return allow();
  }

  if (roleAllowsAction(actor, input.action) && visibility === "TENANT_SHARED") {
    return allow();
  }

  if (hasUsableGrant(input, now)) {
    return allow();
  }

  return deny("resource access denied");
}
