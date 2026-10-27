"use client";

import { SessionProvider } from "next-auth/react";
import { SocketProvider } from "@/components/chat/socket-context";
import { AppBasePathProvider } from "@/components/app-base-path";
import { withBasePath } from "@/lib/base-path";

export function Providers({ children, basePath }: { children: React.ReactNode; basePath: string }) {
  return (
    <AppBasePathProvider basePath={basePath}>
      <SessionProvider basePath={withBasePath("/api/auth", basePath)}>
        <SocketProvider>{children}</SocketProvider>
      </SessionProvider>
    </AppBasePathProvider>
  );
}
