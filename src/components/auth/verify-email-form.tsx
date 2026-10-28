'use client';

import { useState } from "react";
import Link from "@/components/app-link";
import { BrandMark } from "@/components/auth/brand-mark";
import { useBranding } from "@/components/branding-provider";
import { useTranslations } from "next-intl";
import { apiUrl } from "@/lib/api-url";
import { Button } from "@/components/ui/button";

export function VerifyEmailForm({ token }: { token: string }) {
  const t = useTranslations("auth.verify");
  const brand = useBranding();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(token ? "idle" : "error");
  const [message, setMessage] = useState(token ? "" : t("invalid"));

  async function confirm() {
    setStatus("loading");
    try {
      const response = await fetch(apiUrl("/api/auth/verify-email"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(t("invalid"));
      setStatus("success");
      setMessage(result.alreadyVerified ? t("alreadyVerified") : t("success"));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t("invalid"));
    }
  }

  return (
    <section className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-lg" aria-labelledby="verify-email-title">
      <BrandMark className="mx-auto mb-6" />
      <p className="mb-2 text-sm font-semibold text-primary">{brand.name}</p>
      <h1 id="verify-email-title" className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
      {message && <p role={status === "error" ? "alert" : "status"} aria-live="polite" className="mt-5 rounded-md border p-3 text-sm">{message}</p>}
      {status === "success" ? (
        <Button asChild className="mt-6 w-full"><Link href="/auth/login">{t("signIn")}</Link></Button>
      ) : status === "error" ? (
        <div className="mt-6 flex flex-col gap-3">
          {token && <Button variant="default" onClick={confirm}>{t("confirm")}</Button>}
          <Button asChild variant="outline"><Link href="/auth/login">{t("signIn")}</Link></Button>
          <Link className="text-sm text-primary underline" href="/auth/register">{t("registerAgain")}</Link>
        </div>
      ) : (
        <Button className="mt-6 w-full" aria-busy={status === "loading"} disabled={!token || status === "loading"} onClick={confirm}>
          {status === "loading" ? t("confirming") : t("confirm")}
        </Button>
      )}
    </section>
  );
}
