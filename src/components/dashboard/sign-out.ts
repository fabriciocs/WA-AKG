"use client";

import { signOut } from "next-auth/react";
import { withBasePath } from "@/lib/base-path";

type SignOutRequest = (options: {
    redirect: false;
    redirectTo: string;
}) => Promise<{ url?: string | null }>;

/**
 * Auth.js may return a public proxy origin even when sign-out was initiated on
 * localhost. Finish the POST without its automatic redirect, then navigate on
 * the origin that served the dashboard, respecting the reverse-proxy prefix.
 */
export async function signOutToLogin(
    basePath: string,
    signOutRequest: SignOutRequest = signOut,
    navigate: (href: string) => void = href => window.location.assign(href),
): Promise<void> {
    const loginPath = withBasePath("/auth/login", basePath);
    const result = await signOutRequest({ redirect: false, redirectTo: loginPath });

    if (!result?.url) {
        throw new Error("The authentication server did not confirm sign-out.");
    }

    navigate(loginPath);
}
