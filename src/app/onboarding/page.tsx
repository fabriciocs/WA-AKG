import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login?callbackUrl=/onboarding");
  return <OnboardingFlow />;
}
