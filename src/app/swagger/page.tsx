"use client";
import { apiUrl } from "@/lib/api-url";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "@/components/app-link";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { ArrowLeft, BookOpen, ShieldCheck } from "lucide-react";

// Suppress third-party legacy lifecycle warnings from swagger-ui-react (ModelCollapse)
if (typeof window !== "undefined") {
    const isModelCollapseWarning = (...args: unknown[]): boolean => {
        const fullMessage = args
            .map(arg => {
                if (typeof arg === "string") return arg;
                if (typeof arg === "object") {
                    try { return JSON.stringify(arg); } catch { return String(arg); }
                }
                return String(arg);
            })
            .join(" ");
        return (
            fullMessage.includes("ModelCollapse") &&
            (fullMessage.includes("UNSAFE_componentWillReceiveProps") || fullMessage.includes("unsafe-component-lifecycles"))
        );
    };

    const originalError = console.error;
    console.error = (...args: Parameters<typeof console.error>) => {
        if (isModelCollapseWarning(...args)) return;
        originalError.apply(console, args);
    };

    const originalWarn = console.warn;
    console.warn = (...args: Parameters<typeof console.warn>) => {
        if (isModelCollapseWarning(...args)) return;
        originalWarn.apply(console, args);
    };
}

export default function ApiDocsPage() {
    const { data: session, status } = useSession();
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;

        fetch(apiUrl("/api/swagger-auth"), { cache: "no-store" })
            .then((response) => {
                if (cancelled) return;
                if (response.ok) {
                    sessionStorage.setItem("swagger_auth", "true");
                    setAuthorized(true);
                } else {
                    sessionStorage.removeItem("swagger_auth");
                    setAuthorized(false);
                }
            })
            .catch(() => {
                if (cancelled) return;
                sessionStorage.removeItem("swagger_auth");
                setAuthorized(false);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError("");

        try {
            const response = await fetch(apiUrl("/api/swagger-auth"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({ username, password }),
            });

            if (!response.ok) {
                const result = await response.json().catch(() => null);
                setError(result?.error || "Invalid credentials");
                return;
            }

            sessionStorage.setItem("swagger_auth", "true");
            setAuthorized(true);
            setPassword("");
        } catch {
            setError("Could not verify credentials. Check the server configuration and try again.");
        }
    };

    const handleLogout = async () => {
        try {
            await fetch(apiUrl("/api/swagger-auth"), { method: "DELETE", cache: "no-store" });
        } catch {
            // Clear the local UI state even if the server is temporarily unavailable.
        } finally {
            sessionStorage.removeItem("swagger_auth");
            setAuthorized(false);
            setUsername("");
            setPassword("");
        }
    };

    const sessionAuthenticated = status === "authenticated" && Boolean(session?.user);
    const isAuthorized = authorized || sessionAuthenticated;

    if (loading || status === "loading") {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <div className="text-gray-600 text-sm font-medium">Loading API Documentation...</div>
                </div>
            </div>
        );
    }

    if (!isAuthorized) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
                <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
                    <div className="text-center mb-6">
                        <h1 className="text-3xl font-bold text-gray-800 mb-2">
                            WA-AKG API Documentation
                        </h1>
                        <p className="text-gray-600 text-sm">
                            Please authenticate to access Swagger UI
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Username
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={(event) => setUsername(event.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                                placeholder="Enter username"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Password
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                                placeholder="Enter password"
                                required
                            />
                        </div>

                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                        >
                            Access Documentation
                        </button>
                    </form>

                    <div className="mt-6 text-center text-sm text-gray-500">
                        <p>Use the Swagger credentials configured by the server administrator.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white">
            <header className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white p-4 shadow-md">
                <div className="container mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/dashboard"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-all text-xs font-semibold tracking-wide backdrop-blur-sm"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Dashboard
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold flex items-center gap-2">
                                <BookOpen className="w-5 h-5 text-blue-200" />
                                WA-AKG API Documentation
                            </h1>
                            <p className="text-blue-100 text-xs mt-0.5">
                                Interactive API specifications & testing playground
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {sessionAuthenticated && (
                            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 text-xs text-blue-100 border border-white/20">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                                {session.user.email} ({session.user.role || "USER"})
                            </span>
                        )}
                        <Link
                            href="/dashboard/api-docs"
                            className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium"
                        >
                            Overview
                        </Link>
                        {authorized && (
                            <button
                                onClick={handleLogout}
                                className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors text-xs font-medium"
                            >
                                Logout
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="container mx-auto py-6 px-4">
                <SwaggerUI url="/api/docs" />
            </main>
        </div>
    );
}
