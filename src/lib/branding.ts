export const DEFAULT_BRAND_NAME = "ConectaFlow";
export const DEFAULT_BRAND_TAGLINE = "Atendimento no WhatsApp, do seu jeito.";
export const DEFAULT_BRAND_DESCRIPTION = "Organize conversas, automações e equipes em um só lugar.";
export const DEFAULT_LOGO_URL = "";
export const DEFAULT_FAVICON_URL = "/favicon.ico";

/** The values that were emitted by the pre-rebrand defaults. */
export const LEGACY_DEFAULT_BRAND_NAME = "WA-AKG";
export const LEGACY_DEFAULT_BOT_NAME = "WA-AKG Bot";

export interface BrandConfig {
  name: string;
  tagline: string;
  description: string;
  logoUrl: string;
  faviconUrl: string;
  initials: string;
  logoFallback: string;
}

export interface BrandSystemConfig {
  appName?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
}

export interface BrandEnvironment {
  APP_TAGLINE?: string;
  APP_DESCRIPTION?: string;
}

export interface BrandResolutionInput {
  systemConfig?: BrandSystemConfig | null;
  environment?: BrandEnvironment;
}

/**
 * Keeps whitespace-only values from becoming visible branding or defaults.
 * This helper intentionally does not log or expose configuration values.
 */
function nonBlank(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isSafeAssetUrl(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;

  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function resolveAssetUrl(value: string | null | undefined, fallback: string): string {
  const candidate = nonBlank(value);
  return candidate && isSafeAssetUrl(candidate) ? candidate : fallback;
}

export function isLegacyBrandName(value: string | null | undefined): boolean {
  return nonBlank(value)?.toLowerCase() === LEGACY_DEFAULT_BRAND_NAME.toLowerCase();
}

export function isLegacyBotName(value: string | null | undefined): boolean {
  return nonBlank(value)?.toLowerCase() === LEGACY_DEFAULT_BOT_NAME.toLowerCase();
}

export function brandInitials(name = DEFAULT_BRAND_NAME): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C";
}

export function getDefaultBotName(brandName = DEFAULT_BRAND_NAME): string {
  return `${nonBlank(brandName) || DEFAULT_BRAND_NAME} Bot`;
}

/**
 * Keeps a user/session-specific bot name, while translating only the old
 * implicit default to the current brand. Empty values also use the new default.
 */
export function resolveBotDisplayName(
  configuredName: string | null | undefined,
  brandName = DEFAULT_BRAND_NAME,
): string {
  const normalized = nonBlank(configuredName);
  return !normalized || isLegacyBotName(normalized) ? getDefaultBotName(brandName) : normalized;
}

/**
 * Resolves the shared branding contract without requiring Prisma. Keeping this
 * pure makes precedence and legacy compatibility directly unit-testable.
 */
export function resolveBrandConfig({ systemConfig, environment = {} }: BrandResolutionInput = {}): BrandConfig {
  const configuredName = nonBlank(systemConfig?.appName);
  const name = configuredName && !isLegacyBrandName(configuredName)
    ? configuredName
    : DEFAULT_BRAND_NAME;
  const initials = brandInitials(name);

  return {
    name,
    tagline: nonBlank(environment.APP_TAGLINE) || DEFAULT_BRAND_TAGLINE,
    description: nonBlank(environment.APP_DESCRIPTION) || DEFAULT_BRAND_DESCRIPTION,
    logoUrl: resolveAssetUrl(systemConfig?.logoUrl, DEFAULT_LOGO_URL),
    faviconUrl: resolveAssetUrl(systemConfig?.faviconUrl, DEFAULT_FAVICON_URL),
    initials,
    logoFallback: initials,
  };
}

/**
 * Backwards-compatible constants for existing Server Components. New code
 * that needs SystemConfig values should use getBrandConfig() or useBranding().
 */
export const BRAND_NAME = DEFAULT_BRAND_NAME;
export const BRAND_TAGLINE = process.env.APP_TAGLINE?.trim() || DEFAULT_BRAND_TAGLINE;
export const BRAND_DESCRIPTION = process.env.APP_DESCRIPTION?.trim() || DEFAULT_BRAND_DESCRIPTION;
export const BRAND_LOGO_URL = process.env.LOGO_URL?.trim() || DEFAULT_LOGO_URL;
