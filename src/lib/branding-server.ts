import { prisma } from "@/lib/prisma";
import { resolveBrandConfig, type BrandConfig } from "@/lib/branding";

/**
 * Resolves the runtime branding from the singleton SystemConfig and the
 * server-only environment. Failures fall back to the safe built-in identity.
 */
export async function getBrandConfig(): Promise<BrandConfig> {
  const environment = {
    APP_TAGLINE: process.env.APP_TAGLINE,
    APP_DESCRIPTION: process.env.APP_DESCRIPTION,
  };

  try {
    const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    return resolveBrandConfig({ systemConfig, environment });
  } catch (error) {
    console.error("Failed to fetch system config for branding:", error);
    return resolveBrandConfig({ environment });
  }
}
