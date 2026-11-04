import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requestBasePath, withBasePath } from "@/lib/base-path";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    const basePath = requestBasePath(await headers());
    const callbackUrl = withBasePath("/onboarding", basePath);
    const params = new URLSearchParams({ callbackUrl });
    redirect(withBasePath(`/auth/login?${params.toString()}`, basePath));
  }
  return <OnboardingFlow />;
}
