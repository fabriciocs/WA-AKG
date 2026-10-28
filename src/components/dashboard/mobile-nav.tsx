"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, LogOut } from "lucide-react";
import Link from "@/components/app-link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";
import { navGroups } from "./sidebar-nav";
import pkg from "../../../package.json";
import { useBranding } from "@/components/branding-provider";

export function MobileNav({ appName }: { appName?: string }) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const { data: session } = useSession();
    const t = useTranslations();
    const userRole = session?.user?.role;
    const brand = useBranding();
    const resolvedAppName = brand.name || appName || "ConectaFlow";

    const isActive = (href: string) => {
        if (href === "/dashboard") return pathname === "/dashboard";
        return pathname.startsWith(href);
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden min-h-10 min-w-10" aria-label="Open navigation" title="Open navigation">
                    <Menu className="h-5 w-5" />
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85vw] sm:w-[320px] p-0 flex flex-col">
                <SheetHeader className="px-5 py-4 text-left border-b border-border">
                    <div className="flex items-center gap-3">
                        {brand.logoUrl ? <img src={brand.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold" aria-hidden="true">{brand.initials}</div>}
                        <div className="min-w-0">
                            <SheetTitle className="text-xl font-bold text-foreground truncate">{resolvedAppName}</SheetTitle>
                            <SheetDescription className="text-[11px] text-muted-foreground -mt-1 truncate">{brand.tagline}</SheetDescription>
                        </div>
                    </div>
                </SheetHeader>

                <nav aria-label={`${resolvedAppName} navigation`} className="flex-1 px-3 py-3 overflow-y-auto space-y-1">
                    {navGroups.map((group) => {
                        const visibleItems = group.items.filter((item) => {
                            if (item.superadminOnly && userRole !== "SUPERADMIN") return false;
                            if (item.allowedRoles && (!userRole || !item.allowedRoles.includes(userRole))) return false;
                            return true;
                        });
                        if (visibleItems.length === 0) return null;

                        return (
                            <div key={group.key} className="mb-1">
                                {group.key !== "main" && (
                                    <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        {t(`nav.groups.${group.key}`)}
                                    </p>
                                )}
                                <div className="space-y-0.5">
                                    {visibleItems.map(({ href, key, icon: Icon, external }) => (
                                        <Link
                                            key={href}
                                            href={href}
                                            target={external ? "_blank" : undefined}
                                            rel={external ? "noreferrer" : undefined}
                                            aria-current={isActive(href) ? "page" : undefined}
                                            onClick={() => setOpen(false)}
                                            className={`
                                                flex items-center rounded-lg text-sm font-medium
                                                transition-all duration-200 group relative
                                                gap-3 px-3 py-2
                                                ${isActive(href)
                                                    ? "text-primary bg-primary/10 shadow-sm"
                                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                }
                                            `}
                                        >
                                            {isActive(href) && (
                                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-primary rounded-r-full" />
                                            )}
                                            <Icon
                                                size={17}
                                                className={`flex-shrink-0 transition-colors duration-200 ${isActive(href) ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"}`}
                                            />
                                            <span className="truncate">{t(`nav.items.${key}`)}</span>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-border bg-muted/30">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary border border-primary/10" aria-hidden="true">
                            {session?.user?.name?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{session?.user?.name || t("common.user")}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{session?.user?.email}</p>
                        </div>
                    </div>
                    <LanguageSwitcher className="w-full mb-2" />
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full flex items-center justify-center gap-2 text-xs h-10"
                        onClick={async () => {
                            setOpen(false);
                            await signOut({ callbackUrl: "/auth/login" });
                        }}
                    >
                        <LogOut size={14} /> {t("common.signOut")}
                    </Button>
                    <p className="text-[10px] text-muted-foreground/60 text-center mt-2 font-mono">v{pkg.version}</p>
                </div>
            </SheetContent>
        </Sheet>
    );
}
