import NextAuth from "next-auth";
import { authConfig } from "./src/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Exclude API/assets with or without the configured Next.js basePath.
  // The explicit /wa-akg alternatives prevent auth middleware from redirecting API requests.
  matcher: ['/((?!api|_next/static|_next/image|wa-akg/api|wa-akg/_next/static|wa-akg/_next/image|.*\\.png$).*)'],
};
