"use client";

import { SessionProvider } from "next-auth/react";
import { SocketProvider } from "@/components/chat/socket-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath={(process.env.NEXT_PUBLIC_BASE_PATH || "") + "/api/auth"}>
      <SocketProvider>
        {children}
      </SocketProvider>
    </SessionProvider>
  );
}
