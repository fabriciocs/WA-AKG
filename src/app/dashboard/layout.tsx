import { auth } from "@/lib/auth";
import { Navbar } from "@/components/dashboard/navbar";
import { SessionProvider } from "@/components/dashboard/session-provider";
import { SidebarProvider } from "@/components/dashboard/sidebar-context";
import { SidebarShell } from "@/components/dashboard/sidebar-shell";
import { UpdateChecker } from "@/components/dashboard/update-checker";
import { RegistrationWarning } from "@/components/dashboard/registration-warning";
import { prisma } from "@/lib/prisma";
import { Toaster } from "sonner";
import pkg from "../../../package.json";
import { getBrandConfig } from "@/lib/branding-server";


export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    const brandConfig = await getBrandConfig();
    const registrationEnabled = systemConfig?.enableRegistration ?? true;

    return (
        <SessionProvider>
            <SidebarProvider>
                <UpdateChecker />
                <RegistrationWarning
                    role={session?.user?.role as string}
                    registrationEnabled={registrationEnabled}
                />
                <div className="flex h-screen bg-background relative overflow-hidden" suppressHydrationWarning={true}>
                    {/* Subtle ambient background */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0" suppressHydrationWarning={true}>
                        <div className="absolute -top-[20%] -left-[10%] w-[35rem] h-[35rem] bg-primary/[0.03] rounded-full blur-[100px]" />
                        <div className="absolute -bottom-[20%] -right-[10%] w-[25rem] h-[25rem] bg-primary/[0.03] rounded-full blur-[80px]" />
                    </div>

                    {/* Sidebar */}
                    <SidebarShell
                        appName={brandConfig.name}
                        userName={session?.user?.name}
                        userEmail={session?.user?.email}
                        version={pkg.version}
                    />

                    {/* Main Content */}
                    <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative z-10" suppressHydrationWarning={true}>
                        <Navbar appName={brandConfig.name} />
                        <main className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6 styled-scrollbar">
                            {children}
                        </main>
                    </div>
                    <Toaster />
                </div>
            </SidebarProvider>
        </SessionProvider>
    );
}
