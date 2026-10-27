"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { UrlObject } from "url";
import { withBasePath } from "@/lib/base-path";

const AppBasePathContext = createContext("");

export function AppBasePathProvider({ basePath, children }: { basePath: string; children: React.ReactNode }) {
  return <AppBasePathContext.Provider value={basePath}>{children}</AppBasePathContext.Provider>;
}

export function useAppBasePath() {
  return useContext(AppBasePathContext);
}

export function useAppRouter() {
  const router = useRouter();
  const basePath = useAppBasePath();

  return useMemo(() => ({
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(withBasePath(href, basePath), options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(withBasePath(href, basePath), options),
    prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(withBasePath(href, basePath), options),
  }), [router, basePath]);
}

export function withAppBasePath(href: string | UrlObject, basePath: string): string | UrlObject {
  if (typeof href === "string") return withBasePath(href, basePath);
  return { ...href, pathname: withBasePath(href.pathname || "/", basePath) };
}
