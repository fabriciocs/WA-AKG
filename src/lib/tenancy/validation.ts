const TENANT_NAME_MAX_LENGTH = 120;
const TENANT_SLUG_MAX_LENGTH = 63;
const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type TenantCreateInput = { name: string; slug: string };
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length === 0 ||
    normalized.length > TENANT_NAME_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) return null;
  return normalized;
}

function normalizeSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > TENANT_SLUG_MAX_LENGTH ||
    !TENANT_SLUG_PATTERN.test(normalized) ||
    /^personal-[0-9a-f]{32}$/.test(normalized)
  ) return null;
  return normalized;
}

export function parseTenantCreateInput(value: unknown): ValidationResult<TenantCreateInput> {
  if (!isRecord(value)) return { ok: false, error: "Tenant payload must be an object" };
  const name = normalizeName(value.name);
  const slug = normalizeSlug(value.slug);
  if (!name || !slug) return { ok: false, error: "Tenant name and slug are invalid" };
  return { ok: true, value: { name, slug } };
}

export function parseTenantIdHeader(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return TENANT_ID_PATTERN.test(normalized) ? normalized : null;
}

export function parseTenantIdSelector(value: unknown): string | null {
  return typeof value === "string" ? parseTenantIdHeader(value) : null;
}

export const tenantValidationLimits = {
  name: TENANT_NAME_MAX_LENGTH,
  slug: TENANT_SLUG_MAX_LENGTH,
};
