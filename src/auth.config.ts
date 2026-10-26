import type { NextAuthConfig } from "next-auth";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const authConfig = {
    basePath: basePath + '/api/auth',
    pages: {
        signIn: basePath + '/auth/login',
    },
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            // Next.js may strip basePath from pathname before the middleware callback runs.
            // Prefer the request's parsed basePath, then fall back to the configured environment value.
            const requestBasePath = nextUrl.basePath || basePath;
            const pathname = requestBasePath && nextUrl.pathname.startsWith(requestBasePath)
                ? nextUrl.pathname.slice(requestBasePath.length) || '/'
                : nextUrl.pathname;
            const isOnDashboard = pathname.startsWith('/dashboard');
            
            if (isOnDashboard) {
                if (isLoggedIn) return true;

                // Return an explicit prefixed URL instead of Auth.js's default sign-in redirect,
                // which can omit basePath in custom-server/dev configurations.
                const loginUrl = new URL(requestBasePath + '/auth/login', nextUrl);
                const callbackUrl = requestBasePath + pathname + nextUrl.search;
                loginUrl.searchParams.set('callbackUrl', callbackUrl);
                return Response.redirect(loginUrl);
            } else if (isLoggedIn && pathname === '/auth/login') {
                return Response.redirect(new URL(requestBasePath + '/dashboard', nextUrl));
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
