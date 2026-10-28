import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "@/components/app-link";
import {
    Plus,
    Wifi,
    WifiOff,
    Bot,
    Send,
    QrCode,
    ArrowRight,
    Activity,
    Zap,
} from "lucide-react";

import { auth } from "@/lib/auth";
import { getAccessibleSessions } from "@/lib/api-auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { requestBasePath, withBasePath } from "@/lib/base-path";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    const requestHeaders = await headers();
    const basePath = requestBasePath(requestHeaders);
    const session = await auth();
    if (!session?.user) {
        redirect(withBasePath("/auth/login", basePath));
    }

    const t = await getTranslations("dashboard");

    const sessions = await getAccessibleSessions(session.user.id!, session.user.role || "USER");
    const account = await prisma.user.findUnique({ where: { id: session.user.id! }, select: { emailVerified: true } });

    const totalSessions = sessions.length;
    const connectedSessions = sessions.filter(s => s.status === 'CONNECTED').length;
    const disconnectedSessions = totalSessions - connectedSessions; // Anything not connected is disconnected
    const activeMcpGrant = await prisma.oAuthRefreshToken.findFirst({
        where: { userId: session.user.id!, revokedAt: null, expiresAt: { gt: new Date() }, scope: { contains: "mcp:read" } },
        select: { id: true },
    });
    const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
    const protocol = requestHeaders.get("x-forwarded-proto") || "https";
    const configuredOrigin = process.env.OAUTH_ISSUER_URL || process.env.BASE_URL || (host ? `${protocol}://${host}` : "");
    let origin = "";
    let issuerPath = "";
    if (configuredOrigin) {
        try {
            const issuer = new URL(configuredOrigin);
            origin = issuer.origin;
            issuerPath = issuer.pathname.replace(/\/$/, "");
        } catch {
            origin = configuredOrigin.replace(/\/$/, "");
        }
    }
    const mcpPath = process.env.WA_AKG_MCP_HTTP_PATH || "/mcp";
    const mcpEnabled = process.env.WA_AKG_MCP_ENABLED === "true";
    const mcpEndpoint = `${origin}${issuerPath || basePath}${mcpPath.startsWith("/") ? mcpPath : `/${mcpPath}`}`;

    // Fetch auto-reply count for accessible sessions
    let autoReplyCount = 0;
    try {
        const sessionIds = sessions.map(s => s.sessionId);
        if (sessionIds.length > 0) {
            autoReplyCount = await prisma.autoReply.count({
                where: { sessionId: { in: sessionIds } }
            });
        }
    } catch {
        // If auto-reply table doesn't exist yet, just show 0
    }

    const stats = [
        {
            title: t("stats.totalSessions"),
            value: totalSessions,
            icon: QrCode,
            description: t("stats.totalSessionsDesc"),
            color: "text-primary",
            bg: "bg-primary/10",
        },
        {
            title: t("stats.connected"),
            value: connectedSessions,
            icon: Wifi,
            description: t("stats.connectedDesc"),
            color: "text-emerald-600",
            bg: "bg-emerald-500/10",
        },
        {
            title: t("stats.disconnected"),
            value: disconnectedSessions,
            icon: WifiOff,
            description: t("stats.disconnectedDesc"),
            color: "text-red-500",
            bg: "bg-destructive/10",
        },
        {
            title: t("stats.autoReplyRules"),
            value: autoReplyCount,
            icon: Zap,
            description: t("stats.autoReplyRulesDesc"),
            color: "text-amber-600",
            bg: "bg-amber-500/10",
        },
    ];

    const quickActions = [
        { href: "/dashboard/sessions", label: t("quickActions.newSession"), icon: Plus, description: t("quickActions.newSessionDesc") },
        { href: "/dashboard/chat", label: t("quickActions.sendMessage"), icon: Send, description: t("quickActions.sendMessageDesc") },
        { href: "/dashboard/bot-settings", label: t("quickActions.botSettings"), icon: Bot, description: t("quickActions.botSettingsDesc") },
        { href: "/dashboard/system-monitor", label: t("quickActions.systemMonitor"), icon: Activity, description: t("quickActions.systemMonitorDesc") },
    ];

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{t("title")}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <Link href="/dashboard/sessions">
                    <Button size="sm" className="gap-2">
                        <Plus className="h-4 w-4" /> {t("addSession")}
                    </Button>
                </Link>
            </div>

            <Card className="border-primary/20 bg-primary/[0.03]">
                <CardContent className="space-y-4 p-5">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t("onboarding.eyebrow")}</p>
                        <h3 className="mt-1 text-lg font-semibold">{t("onboarding.title")}</h3>
                        <p className="text-sm text-muted-foreground">{t("onboarding.description")}</p>
                    </div>
                    <ol className="grid gap-3 md:grid-cols-3">
                        <li className="rounded-lg border bg-background p-3">
                            <p className="text-sm font-medium">{t("onboarding.account")}</p>
                            <p className={`mt-1 text-xs ${account?.emailVerified ? "text-emerald-600" : "text-muted-foreground"}`}>{account?.emailVerified ? t("onboarding.accountComplete") : t("onboarding.accountPending")}</p>
                            {!account?.emailVerified && <Link className="mt-2 inline-block text-xs font-medium text-primary underline" href="/auth/login">{t("onboarding.resendVerification")}</Link>}
                        </li>
                        <li className="rounded-lg border bg-background p-3">
                            <p className="text-sm font-medium">{t("onboarding.whatsapp", { count: connectedSessions, total: totalSessions })}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{connectedSessions > 0 ? t("onboarding.whatsappComplete") : t("onboarding.whatsappPending")}</p>
                            <Link className="mt-2 inline-block text-xs font-medium text-primary underline" href="/dashboard/sessions">{totalSessions ? t("onboarding.manageSessions") : t("onboarding.createSession")}</Link>
                        </li>
                        <li className="rounded-lg border bg-background p-3">
                            <p className="text-sm font-medium">{t("onboarding.mcp")}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{!mcpEnabled ? t("onboarding.mcpDisabled") : activeMcpGrant ? t("onboarding.mcpComplete") : t("onboarding.mcpPending")}</p>
                            {mcpEndpoint && <p className="mt-2 text-xs text-muted-foreground">{t("onboarding.endpoint")}: <code className="break-all font-mono">{mcpEndpoint}</code></p>}
                            <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.mcpHint")}</p>
                            <Link className="mt-2 inline-block text-xs font-medium text-primary underline" href="/dashboard/oauth">{t("onboarding.connectMcp")}</Link>
                        </li>
                    </ol>
                </CardContent>
            </Card>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <Card key={stat.title} className="glass-panel border-border/50 shadow-sm hover:shadow-md hover:shadow-primary/5 transition-all duration-300">
                            <CardContent className="p-4 sm:p-5">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{stat.title}</p>
                                        <p className="text-2xl sm:text-3xl font-extrabold text-foreground">{stat.value}</p>
                                        <p className="text-xs text-muted-foreground/70">{stat.description}</p>
                                    </div>
                                    <div className={`${stat.bg} p-2.5 rounded-xl border object-contain border-white/20 dark:border-white/10 shadow-sm`}>
                                        <Icon className={`h-5 w-5 ${stat.color}`} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Quick Actions */}
            <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("quickActions.title")}</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {quickActions.map((action) => {
                        const Icon = action.icon;
                        return (
                            <Link key={action.href} href={action.href}>
                                <Card className="glass-panel border-border/50 shadow-sm hover:shadow-md hover:shadow-primary/10 hover:-translate-y-0.5 transition-all duration-300 group cursor-pointer h-full">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <div className="bg-muted/50 p-2.5 rounded-xl group-hover:bg-primary transition-colors border border-border/50 shadow-sm">
                                            <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary-foreground transition-colors" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-foreground truncate">{action.label}</p>
                                            <p className="text-xs text-muted-foreground/80 truncate">{action.description}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                </div>
            </div>

            {/* Sessions List */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{t("sessions.title")}</h3>
                    <Link href="/dashboard/sessions" className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors">
                        {t("sessions.viewAll")} <ArrowRight size={14} />
                    </Link>
                </div>

                {sessions.length === 0 ? (
                    <Card className="border-dashed border-2 border-border shadow-none">
                        <CardContent className="py-12 text-center">
                            <div className="bg-primary/10 h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-3">
                                <QrCode className="h-6 w-6 text-primary" />
                            </div>
                            <p className="text-sm font-medium text-foreground mb-1">{t("sessions.emptyTitle")}</p>
                            <p className="text-xs text-muted-foreground mb-4">{t("sessions.emptyDescription")}</p>
                            <Link href="/onboarding">
                                <Button size="sm" variant="outline" className="gap-2">
                                    <Plus className="h-4 w-4" /> {t("sessions.createSession")}
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {sessions.map(s => {
                            const isConnected = s.status === 'CONNECTED';
                            const isDisconnected = !isConnected;

                            return (
                                <Link key={s.id} href={`/dashboard/sessions/${s.sessionId}`}>
                                    <Card className="glass-panel border-border/50 shadow-sm hover:shadow-md hover:shadow-primary/5 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer h-full">
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-bold text-foreground truncate">{s.name}</p>
                                                    <p className="text-xs text-muted-foreground font-mono truncate mt-1">{s.sessionId}</p>
                                                </div>
                                                <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0
                                                    ${isConnected ? 'bg-emerald-50 text-emerald-700' : isDisconnected ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}
                                                `}>
                                                    <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : isDisconnected ? 'bg-red-400' : 'bg-amber-400'}`} />
                                                    {s.status}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
