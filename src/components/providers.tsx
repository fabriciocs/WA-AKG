"use client";

import { SessionProvider } from "next-auth/react";
import { SocketProvider } from "@/components/chat/socket-context";
import { AppBasePathProvider } from "@/components/app-base-path";
import { withBasePath } from "@/lib/base-path";
import { BrandProvider } from "@/components/branding-provider";
import type { BrandConfig } from "@/lib/branding";

export function Providers({ children, basePath, brandConfig }: { children: React.ReactNode; basePath: string; brandConfig: BrandConfig }) {
  return (
    <AppBasePathProvider basePath={basePath}>
      <SessionProvider basePath={withBasePath("/api/auth", basePath)}>
        <BrandProvider brandConfig={brandConfig}>
          <SocketProvider>{children}</SocketProvider>
        </BrandProvider>
      </SessionProvider>
    </AppBasePathProvider>
  );
}
