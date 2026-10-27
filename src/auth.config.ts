import type { NextAuthConfig } from "next-auth";
import { requestBasePath, requestPublicOrigin, withBasePath } from "@/lib/base-path";

export const authConfig = {
    basePath: '/api/auth',
    pages: {
        signIn: '/auth/login',
    },
    callbacks: {
        authorized({ auth, request }) {
            const { nextUrl } = request;
            const isLoggedIn = !!auth?.user;
            const basePath = requestBasePath(request.headers);
            const pathname = nextUrl.pathname;
            const isOnDashboard = pathname.startsWith('/dashboard');
            
            if (isOnDashboard) {
                if (isLoggedIn) return true;

                // Return an explicit prefixed URL instead of Auth.js's default sign-in redirect,
                // which can omit basePath in custom-server/dev configurations.
                const loginUrl = new URL(withBasePath('/auth/login', basePath), requestPublicOrigin(request.headers, nextUrl));
                const callbackUrl = withBasePath(pathname, basePath) + nextUrl.search;
                loginUrl.searchParams.set('callbackUrl', callbackUrl);
                return Response.redirect(loginUrl);
            } else if (isLoggedIn && pathname === '/auth/login') {
                return Response.redirect(new URL(withBasePath('/dashboard', basePath), requestPublicOrigin(request.headers, nextUrl)));
            }
            return true;
        },
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
                token.role = user.role;
            }
            return token;
        },
        async session({ session, token }) {
            if (token && session.user) {
                session.user.id = token.id as string;
                session.user.role = token.role;
            }
            return session;
        }
    },
    providers: [], // Configured in auth.ts
    session: {
        strategy: 'jwt'
    },
    trustHost: true,
} satisfies NextAuthConfig;
