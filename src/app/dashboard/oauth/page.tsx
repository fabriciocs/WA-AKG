import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import OAuthManagement from "@/components/dashboard/oauth-management";
import { headers } from "next/headers";
import { requestBasePath, withBasePath } from "@/lib/base-path";

export const dynamic = "force-dynamic";

export default async function OAuthManagementPage() {
  const session = await auth();
  const basePath = requestBasePath(await headers());
  if (!session?.user?.id) {
    const callbackUrl = withBasePath("/dashboard/oauth", basePath);
    redirect(withBasePath(`/auth/login?${new URLSearchParams({ callbackUrl }).toString()}`, basePath));
  }
  if (session.user.role !== "SUPERADMIN") redirect(withBasePath("/dashboard", basePath));
  return <OAuthManagement canManage={session.user.role === "SUPERADMIN"} />;
}
