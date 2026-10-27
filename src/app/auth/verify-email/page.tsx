import { Suspense } from "react";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const t = await getTranslations("auth.verify");
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Suspense fallback={<p>{t("loading")}</p>}>
        <VerifyEmailForm token={token || ""} />
      </Suspense>
    </main>
  );
}
