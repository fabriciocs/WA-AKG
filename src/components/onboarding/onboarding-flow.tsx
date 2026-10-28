'use client';

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/api-url";
import { useAppRouter as useRouter } from "@/components/app-base-path";
import Link from "@/components/app-link";
import { BrandMark } from "@/components/auth/brand-mark";
import { useBranding } from "@/components/branding-provider";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "onboarding:first-session";

export function OnboardingFlow() {
  const router = useRouter();
  const brand = useBranding();
  const t = useTranslations("dashboard.onboarding");
  const dashboardT = useTranslations("dashboard");
  const sessionsT = useTranslations("sessions");
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const steps = [t("title"), t("createSession"), t("whatsappComplete")];

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored) as { sessionId?: string; name?: string; connected?: boolean };
      if (!parsed.sessionId) return;
      setSessionId(parsed.sessionId);
      setName(parsed.name || "");
      setStep(parsed.connected ? 2 : 1);
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  async function createFirstSession(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (name.trim().length < 2) { setError(sessionsT("nameRequired")); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(apiUrl("/api/sessions"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.data?.sessionId) throw new Error(result?.message || sessionsT("createdFailed"));
      const createdSessionId = String(result.data.sessionId);
      setSessionId(createdSessionId);
      setStep(1);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: createdSessionId, name: name.trim(), connected: false }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : sessionsT("createdFailed")); }
    finally { setLoading(false); }
  }

  function markConnected() {
    setStep(2);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, name, connected: true }));
    } catch {
      // The flow remains usable when browser storage is unavailable.
    }
  }

  return <main className="min-h-screen bg-background px-5 py-10 text-foreground" aria-labelledby="onboarding-title"><div className="mx-auto max-w-3xl">
    <div className="flex items-start justify-between gap-6"><div className="flex items-start gap-3"><BrandMark className="h-11 w-11 rounded-xl text-sm" /><div><p className="text-sm font-semibold text-primary">{brand.name}</p><h1 id="onboarding-title" className="mt-2 text-3xl font-bold tracking-tight">{t("title")}</h1><p className="mt-2 max-w-xl text-sm text-muted-foreground">{brand.tagline}</p></div></div><Button variant="ghost" onClick={() => router.push("/dashboard")}>{t("manageSessions")}</Button></div>
    <ol className="mt-10 grid gap-3 sm:grid-cols-3" aria-label="Progresso da configuração">{steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className={`border-t pt-3 text-sm ${index <= step ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}><span className="mr-2 font-mono text-xs">0{index + 1}</span>{label}</li>)}</ol>
    <section className="mt-12 rounded-3xl border border-border bg-card p-7 shadow-sm sm:p-10" aria-live="polite" aria-busy={loading}>
      {step === 0 && <form onSubmit={createFirstSession}><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><MessageCircle className="h-6 w-6" aria-hidden="true" /></div><h2 className="mt-7 text-2xl font-semibold">{t("createSession")}</h2><p className="mt-3 max-w-xl leading-7 text-muted-foreground">{t("whatsappPending")}</p><label htmlFor="session-name" className="mt-8 block text-sm font-medium">{sessionsT("nameLabel")}</label><Input id="session-name" value={name} onChange={(event) => { setName(event.target.value); if (error) setError(""); }} placeholder={sessionsT("namePlaceholder")} autoComplete="organization" autoFocus aria-describedby={error ? "session-name-error" : undefined} aria-invalid={Boolean(error)} className="mt-2 h-12" />{error && <p id="session-name-error" role="alert" className="mt-2 text-sm text-destructive">{error}</p>}<Button type="submit" className="mt-6 h-12 rounded-xl px-6" disabled={loading}>{loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> {sessionsT("creatingButton")}</> : <>Continuar <ArrowRight className="ml-2 h-4 w-4" /></>}</Button></form>}
      {step === 1 && <div className="py-10 text-center"><ShieldCheck className="mx-auto h-12 w-12 text-primary" aria-hidden="true" /><h2 className="mt-5 text-2xl font-semibold">{sessionsT("createdSuccess")}</h2><p className="mx-auto mt-3 max-w-md text-muted-foreground">{t("whatsappPending")}</p><p className="mt-2 text-sm font-medium text-foreground">{name}</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Button asChild className="h-12 rounded-xl"><Link href={`/dashboard/sessions/${encodeURIComponent(sessionId)}`}>{t("manageSessions")} <ArrowRight className="ml-2 h-4 w-4" /></Link></Button><Button type="button" variant="outline" className="h-12 rounded-xl" onClick={markConnected}>{t("whatsappComplete")}</Button></div></div>}
      {step === 2 && <div className="py-10 text-center"><Check className="mx-auto h-12 w-12 text-primary" aria-hidden="true" /><h2 className="mt-5 text-2xl font-semibold">{t("whatsappComplete")}</h2><p className="mx-auto mt-3 max-w-md text-muted-foreground">{t("description")}</p><Button type="button" className="mt-7 h-12 rounded-xl" onClick={() => router.push("/dashboard")}>{dashboardT("title")} <ArrowRight className="ml-2 h-4 w-4" /></Button></div>}
    </section><p className="mt-6 text-center text-xs text-muted-foreground">{t("mcpHint")}</p>
  </div></main>;
}
