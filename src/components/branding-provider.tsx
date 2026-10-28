"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BrandConfig } from "@/lib/branding";

const BrandingContext = createContext<BrandConfig | null>(null);

export function BrandProvider({ brandConfig, children }: { brandConfig: BrandConfig; children: ReactNode }) {
  return <BrandingContext.Provider value={brandConfig}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandConfig {
  const brandConfig = useContext(BrandingContext);

  if (!brandConfig) {
    throw new Error("useBranding must be used inside BrandProvider");
  }

  return brandConfig;
}
