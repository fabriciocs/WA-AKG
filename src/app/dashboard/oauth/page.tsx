import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import OAuthManagement from "@/components/dashboard/oauth-management";

export const dynamic = "force-dynamic";

export default async function OAuthManagementPage() {
  const session = await auth();
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
  if (!session?.user?.id) {
    const callbackUrl = `${basePath}/dashboard/oauth`;
    redirect(`${basePath}/auth/login?${new URLSearchParams({ callbackUrl }).toString()}`);
  }
  return <OAuthManagement canManage={session.user.role === "SUPERADMIN"} />;
}
