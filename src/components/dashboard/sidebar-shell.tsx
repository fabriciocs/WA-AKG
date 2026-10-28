"use client";

import { SidebarNav } from "./sidebar-nav";
import { useSidebar } from "./sidebar-context";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useAppBasePath } from "@/components/app-base-path";
import { withBasePath } from "@/lib/base-path";
import { useBranding } from "@/components/branding-provider";

interface SidebarShellProps {
    appName: string;
    userName?: string | null;
    userEmail?: string | null;
    version: string;
}

export function SidebarShell({ appName, userName, userEmail, version }: SidebarShellProps) {
    const { isCollapsed } = useSidebar();
    const t = useTranslations("common");
    const basePath = useAppBasePath();
    const brand = useBranding();
    const resolvedAppName = brand.name || appName;

    return (
        <aside
            aria-label={`${resolvedAppName} navigation`}
            className={`
                bg-background/80 backdrop-blur-xl border-r border-border/40
                hidden md:flex flex-col h-full sticky left-0 top-0 z-20
                shadow-[1px_0_12px_-4px_rgba(0,0,0,0.08)]
                transition-all duration-300 ease-in-out
                ${isCollapsed ? "w-[72px]" : "w-[260px]"}
            `}
        >
            {/* Logo / Brand */}
            <div className={`border-b border-border/30 transition-all duration-300 ${isCollapsed ? "px-3 py-4" : "px-5 py-5"}`}>
                {isCollapsed ? (
                    <div className="flex justify-center">
                        {brand.logoUrl ? (
                            <img src={brand.logoUrl} alt={resolvedAppName} className="h-9 w-9 rounded-lg object-cover shadow-sm" />
                        ) : (
                            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm shadow-sm" aria-label={resolvedAppName}>
                                {brand.initials}
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-3 min-w-0">
                            {brand.logoUrl ? (
                                <img src={brand.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover shadow-sm shrink-0" />
                            ) : (
                                <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm shadow-sm shrink-0" aria-hidden="true">
                                    {brand.initials}
                                </div>
                            )}
                            <div className="min-w-0">
                                <h1 className="text-lg font-bold tracking-tight text-foreground truncate">
                                    {resolvedAppName}
                                </h1>
                                <p className="text-[10px] text-muted-foreground mt-0.5 font-medium truncate">{brand.tagline}</p>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Navigation */}
            <SidebarNav />

            {/* User Footer */}
            <div 
                suppressHydrationWarning={true}
                className={`border-t border-border/30 bg-background/40 transition-all duration-300 ${isCollapsed ? "p-2" : "p-4"}`}
            >
                {isCollapsed ? (
                    <div suppressHydrationWarning={true} className="flex flex-col items-center gap-2">
                        <div suppressHydrationWarning={true} className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary border border-primary/10" aria-hidden="true">
                            {userName?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <button
                            onClick={() => signOut({ callbackUrl: withBasePath("/auth/login", basePath) })}
                            aria-label={t("signOut")}
                            title={t("signOut")}
                            className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                ) : (
                    <>
                        <div suppressHydrationWarning={true} className="flex items-center gap-2.5 mb-3">
                            <div 
                                suppressHydrationWarning={true}
                                className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary border border-primary/10"
                            >
                                {userName?.charAt(0)?.toUpperCase() || "U"}
                            </div>
                            <div suppressHydrationWarning={true} className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">{userName || t("user")}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full flex items-center justify-center gap-2 text-xs h-10 rounded-lg border-border/40 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                            onClick={() => signOut({ callbackUrl: withBasePath("/auth/login", basePath) })}
                        >
                            <LogOut size={14} /> {t("signOut")}
                        </Button>
                        <p className="text-[9px] text-muted-foreground/50 text-center mt-2 font-mono">v{version}</p>
                    </>
                )}
            </div>
        </aside>
    );
}
