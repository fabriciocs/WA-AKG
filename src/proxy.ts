import { auth } from "@/lib/auth";
import { validateApiKey } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    // Next.js strips the configured basePath from pathname in the proxy handler,
    // but redirect URLs must include it because Caddy exposes the app under /wa-akg.
    const basePath = request.nextUrl.basePath || process.env.NEXT_PUBLIC_BASE_PATH || "";
    const withBasePath = (path: string) => {
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        return basePath && normalizedPath !== basePath && !normalizedPath.startsWith(`${basePath}/`)
            ? `${basePath}${normalizedPath}`
            : normalizedPath;
    };

    // Public routes that don't require authentication
    const publicRoutes = ["/auth/login", "/auth/register", "/api/auth", "/terms", "/privacy"];

    // Check if it's a public route
    const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

    // Allow Next.js internals and favicon only
    if (
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico" ||
        pathname === "/.well-known/oauth-protected-resource" ||
        pathname === "/.well-known/oauth-authorization-server"
    ) {
        return NextResponse.next();
    }

    // Allow known static asset extensions in root path only (e.g. /vercel.svg)
    const staticExtensions = [".svg", ".ico", ".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".ttf"];
    if (pathname.lastIndexOf("/") === 0 && staticExtensions.some(ext => pathname.endsWith(ext))) {
        return NextResponse.next();
    }

    // API routes: Check for valid API key or session
    if (pathname.startsWith("/api/")) {
        // OAuth protocol endpoints enforce their own client, token, or user-session
        // checks. They must reach their route handlers before an end-user session
        // exists (for example, during authorization-code and token exchange).
        if (pathname.startsWith("/api/auth") || pathname.startsWith("/api/oauth/")) {
            return NextResponse.next();
        }

        // Check for API key in header
        const apiKey = request.headers.get("x-api-key");
        if (apiKey) {
            // Defense-in-depth: validate API key immediately
            const user = await validateApiKey(request);
            if (!user) {
                return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
            }
            return NextResponse.next();
        }

        // Check for session auth
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        return NextResponse.next();
    }

    // Dashboard routes: Require login
    if (pathname.startsWith("/dashboard")) {
        const session = await auth();

        if (!session?.user) {
            const loginUrl = new URL(withBasePath("/auth/login"), request.url);
            loginUrl.searchParams.set("callbackUrl", withBasePath(pathname) + request.nextUrl.search);
            return NextResponse.redirect(loginUrl);
        }

        return NextResponse.next();
    }

    // Root path — redirect to dashboard if logged in
    if (pathname === "/") {
        const session = await auth();
        if (session?.user) {
            return NextResponse.redirect(new URL(withBasePath("/dashboard"), request.url));
        }
        return NextResponse.next();
    }

    // Public routes
    if (isPublicRoute) {
        const session = await auth();
        if (session?.user && (pathname.startsWith("/auth/login") || pathname.startsWith("/auth/register"))) {
            return NextResponse.redirect(new URL(withBasePath("/dashboard"), request.url));
        }
        return NextResponse.next();
    }

    // Default: require auth for everything else
    const session = await auth();
    if (!session?.user) {
        const loginUrl = new URL(withBasePath("/auth/login"), request.url);
        loginUrl.searchParams.set("callbackUrl", withBasePath(pathname) + request.nextUrl.search);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico).*)",
    ],
};
