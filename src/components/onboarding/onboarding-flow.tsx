"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/api-url";
import { isLiveWhatsAppSession, validateMcpDiscovery } from "@/lib/onboarding-health";
import { useAppRouter as useRouter } from "@/components/app-base-path";
import Link from "@/components/app-link";
import { BrandMark } from "@/components/auth/brand-mark";
import { useBranding } from "@/components/branding-provider";
import { useLocale, useTranslations } from "next-intl";

const STORAGE_KEY = "onboarding:first-session";
type McpMode = "http" | "stdio";
type McpCheck = { issuer?: string; resource?: string; detail: string };

const mcpCopy = {
  en: {
    connection: "Verify connection", checking: "Checking connection…", offline: "WhatsApp is not connected yet. Complete QR pairing, then retry.",
    integration: "Connect an MCP client", choose: "Choose how your MCP client will connect.",
    http: "Remote MCP (OAuth)", stdio: "Local MCP (stdio)", httpHelp: "OAuth Authorization Code + PKCE S256 and per-session consent. Best for browser and remote clients.",
    stdioHelp: "Local clients use an individual API key and are read-only by default.",
    checkHttp: "Check OAuth discovery and MCP HTTP", checkStdio: "Check local API-key setup", checkingMcp: "Verifying MCP…",
    setup: "Open OAuth Access", retry: "Try again", finish: "Continue", final: "Next: authorize and test your MCP client",
    readyHttp: "OAuth metadata and the protected MCP endpoint responded correctly. Authorize the client and test tools/list and a read-only tool to complete end-to-end validation.",
    readyStdio: "An API key is provisioned. Configure WA_AKG_API_KEY and WA_AKG_API_BASE_URL on your local client, then verify initialize, tools/list and a read-only tool.",
    noKey: "No local MCP key has been provisioned. Open OAuth Access → Local MCP setup.",
    badChallenge: "MCP did not return the expected OAuth 401 challenge. Check the server flag and the reverse proxy.",
    after: "This wizard checks the server-side prerequisites; a client tool call is still required to confirm the integration.",
    localCommands: "Local verification commands", dashboard: "Go to dashboard", noSession: "The selected session was not found or is unavailable.",
  },
  "pt-BR": {
    connection: "Verificar conexão", checking: "Verificando conexão…", offline: "O WhatsApp ainda não está conectado. Conclua o QR Code e tente novamente.",
    integration: "Conectar um cliente MCP", choose: "Escolha como o cliente MCP se conectará.",
    http: "MCP remoto (OAuth)", stdio: "MCP local (stdio)", httpHelp: "Authorization Code + PKCE S256 e consentimento por sessão. Para clientes web e remotos.",
    stdioHelp: "Clientes locais usam API key individual, somente leitura por padrão.",
    checkHttp: "Verificar discovery OAuth e MCP HTTP", checkStdio: "Verificar configuração da API key local", checkingMcp: "Verificando MCP…",
    setup: "Abrir acesso OAuth", retry: "Tentar novamente", finish: "Continuar", final: "Próxima etapa: autorizar e testar o cliente MCP",
    readyHttp: "Os metadados OAuth e o endpoint MCP protegido responderam corretamente. Autorize o cliente e teste tools/list e uma ferramenta de leitura para validar a integração ponta a ponta.",
    readyStdio: "Há uma API key provisionada. Configure WA_AKG_API_KEY e WA_AKG_API_BASE_URL no cliente local e teste initialize, tools/list e uma ferramenta de leitura.",
    noKey: "Ainda não há credencial MCP local. Abra Acesso OAuth → Configuração MCP local.",
    badChallenge: "O MCP não retornou o desafio OAuth 401 esperado. Revise a flag de ativação e o proxy.",
    after: "Este assistente verifica os pré-requisitos do servidor; a execução de uma ferramenta pelo cliente ainda é necessária para comprovar a integração.",
    localCommands: "Comandos de verificação local", dashboard: "Ir ao painel", noSession: "A sessão selecionada não foi localizada ou está indisponível.",
  },
  id: {
    connection: "Periksa koneksi", checking: "Memeriksa koneksi…", offline: "WhatsApp belum terhubung. Selesaikan pemindaian QR lalu coba lagi.",
    integration: "Hubungkan klien MCP", choose: "Pilih cara klien MCP akan terhubung.",
    http: "MCP jarak jauh (OAuth)", stdio: "MCP lokal (stdio)", httpHelp: "Authorization Code + PKCE S256 dan persetujuan per sesi, untuk klien web dan jarak jauh.",
    stdioHelp: "Klien lokal memakai API key per pengguna, dengan akses baca saja secara default.",
    checkHttp: "Periksa penemuan OAuth dan MCP HTTP", checkStdio: "Periksa API key lokal", checkingMcp: "Memeriksa MCP…",
    setup: "Buka OAuth Access", retry: "Coba lagi", finish: "Lanjutkan", final: "Selanjutnya: otorisasi dan uji klien MCP",
    readyHttp: "Metadata OAuth dan endpoint MCP terlindung telah merespons. Otorisasi klien dan uji tools/list serta alat baca untuk validasi penuh.",
    readyStdio: "API key tersedia. Atur WA_AKG_API_KEY dan WA_AKG_API_BASE_URL pada klien lokal dan uji initialize, tools/list serta alat baca.",
    noKey: "API key lokal belum dibuat. Buka OAuth Access → Local MCP setup.",
    badChallenge: "MCP tidak mengembalikan tantangan OAuth 401. Periksa flag server dan proxy.",
    after: "Wizard ini memeriksa prasyarat server; pemanggilan alat oleh klien masih diperlukan untuk validasi menyeluruh.",
    localCommands: "Perintah verifikasi lokal", dashboard: "Ke dashboard", noSession: "Sesi tidak ditemukan atau tidak tersedia.",
  },
} as const;

export function OnboardingFlow() {
  const router = useRouter();
  const brand = useBranding();
  const t = useTranslations("dashboard.onboarding");
  const dashboardT = useTranslations("dashboard");
  const sessionsT = useTranslations("sessions");
  const locale = useLocale();
  const copy = mcpCopy[locale as keyof typeof mcpCopy] ?? mcpCopy.en;
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<McpMode>("http");
  const [mcpCheck, setMcpCheck] = useState<McpCheck | null>(null);

  const steps = [t("title"), t("createSession"), copy.integration, copy.final];

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { sessionId?: string; name?: string };
      if (!parsed.sessionId) return;
      setSessionId(parsed.sessionId);
      setName(parsed.name || "");
      // Session storage is never proof of an active WhatsApp connection.
      setStep(1);
    } catch {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  async function createFirstSession(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (name.trim().length < 2) { setError(sessionsT("nameRequired")); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(apiUrl("/api/sessions"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.data?.sessionId) throw new Error(result?.message || sessionsT("createdFailed"));
      const createdSessionId = String(result.data.sessionId);
      setSessionId(createdSessionId);
      setStep(1);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: createdSessionId, name: name.trim() }));
      router.push(`/dashboard/sessions/${encodeURIComponent(createdSessionId)}?onboarding=1`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : sessionsT("createdFailed")); }
    finally { setLoading(false); }
  }

  async function verifyWhatsApp() {
    if (!sessionId) { setError(copy.noSession); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}`), { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.status || !isLiveWhatsAppSession(payload.data)) {
        throw new Error(copy.offline);
      }
      setStep(2);
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.offline); }
    finally { setLoading(false); }
  }

  async function verifyMcp() {
    setLoading(true); setError(""); setMcpCheck(null);
    try {
      if (mode === "stdio") {
        const response = await fetch(apiUrl("/api/user/api-key"), { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.data?.configured !== true) throw new Error(copy.noKey);
        setMcpCheck({ detail: copy.readyStdio });
        setStep(3);
        return;
      }
      const [authResponse, resourceResponse] = await Promise.all([
        fetch(apiUrl("/.well-known/oauth-authorization-server"), { cache: "no-store" }),
        fetch(apiUrl("/.well-known/oauth-protected-resource"), { cache: "no-store" }),
      ]);
      if (!authResponse.ok || !resourceResponse.ok) throw new Error("OAuth metadata endpoints are unavailable.");
      const [authorization, resource] = await Promise.all([authResponse.json(), resourceResponse.json()]);
      const result = validateMcpDiscovery(authorization, resource, window.location.origin);
      if (!result.ok) throw new Error(result.reason);
      const resourceUrl = new URL(result.resource);
      const issuerPath = new URL(result.issuer).pathname.replace(/\/+$/, "");
      const localPath = issuerPath && resourceUrl.pathname.startsWith(issuerPath + "/")
        ? resourceUrl.pathname.slice(issuerPath.length) : resourceUrl.pathname;
      // Probe the same-origin route, not the public tunnel: browsers on localhost cannot
      // normally read cross-origin WWW-Authenticate headers from the public OAuth issuer.
      const challenge = await fetch(apiUrl(localPath), { method: "GET", cache: "no-store" });
      if (challenge.status !== 401 || !challenge.headers.get("WWW-Authenticate")?.includes("resource_metadata=")) {
        throw new Error(copy.badChallenge);
      }
      setMcpCheck({ issuer: result.issuer, resource: result.resource, detail: copy.readyHttp });
      setStep(3);
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.badChallenge); }
    finally { setLoading(false); }
  }

  return <main className="min-h-screen bg-background px-5 py-10 text-foreground" aria-labelledby="onboarding-title"><div className="mx-auto max-w-3xl">
    <div className="flex items-start justify-between gap-6"><div className="flex items-start gap-3"><BrandMark className="h-11 w-11 rounded-xl text-sm" /><div><p className="text-sm font-semibold text-primary">{brand.name}</p><h1 id="onboarding-title" className="mt-2 text-3xl font-bold tracking-tight">{t("title")}</h1><p className="mt-2 max-w-xl text-sm text-muted-foreground">{brand.tagline}</p></div></div><Button variant="ghost" onClick={() => router.push("/dashboard")}>{t("manageSessions")}</Button></div>
    <ol className="mt-10 grid gap-3 sm:grid-cols-4" aria-label="Onboarding progress">{steps.map((label, index) => <li key={index} aria-current={index === step ? "step" : undefined} className={`border-t pt-3 text-sm ${index <= step ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}><span className="mr-2 font-mono text-xs">0{index + 1}</span>{label}</li>)}</ol>
    <section className="mt-12 rounded-3xl border border-border bg-card p-7 shadow-sm sm:p-10" aria-live="polite" aria-busy={loading}>
      {step === 0 && <form onSubmit={createFirstSession}><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><MessageCircle className="h-6 w-6" aria-hidden="true" /></div><h2 className="mt-7 text-2xl font-semibold">{t("createSession")}</h2><p className="mt-3 max-w-xl leading-7 text-muted-foreground">{t("whatsappPending")}</p><label htmlFor="session-name" className="mt-8 block text-sm font-medium">{sessionsT("nameLabel")}</label><Input id="session-name" value={name} onChange={(event) => { setName(event.target.value); if (error) setError(""); }} placeholder={sessionsT("namePlaceholder")} autoComplete="organization" autoFocus aria-describedby={error ? "session-name-error" : undefined} aria-invalid={Boolean(error)} className="mt-2 h-12" /><Button type="submit" className="mt-6 h-12 rounded-xl px-6" disabled={loading}>{loading ? sessionsT("creatingButton") : <>Continuar <ArrowRight className="ml-2 h-4 w-4" /></>}</Button></form>}
      {step === 1 && <div className="py-8 text-center"><ShieldCheck className="mx-auto h-12 w-12 text-primary" aria-hidden="true" /><h2 className="mt-5 text-2xl font-semibold">{sessionsT("createdSuccess")}</h2><p className="mx-auto mt-3 max-w-md text-muted-foreground">{t("whatsappPending")}</p><p className="mt-2 text-sm font-medium">{name}</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><Button asChild variant="outline"><Link href={`/dashboard/sessions/${encodeURIComponent(sessionId)}`}>{t("manageSessions")}</Link></Button><Button disabled={loading} onClick={verifyWhatsApp}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{loading ? copy.checking : copy.connection}</Button></div></div>}
      {step === 2 && <div className="space-y-6"><h2 className="text-2xl font-semibold">{copy.integration}</h2><p className="text-muted-foreground">{copy.choose}</p><div className="grid gap-3 sm:grid-cols-2">{(["http", "stdio"] as const).map((option) => <button type="button" key={option} onClick={() => { setMode(option); setError(""); }} aria-pressed={mode === option} className={`rounded-xl border p-5 text-left ${mode === option ? "border-primary ring-1 ring-primary" : "border-border"}`}><span className="block font-semibold">{option === "http" ? copy.http : copy.stdio}</span><span className="mt-2 block text-sm text-muted-foreground">{option === "http" ? copy.httpHelp : copy.stdioHelp}</span></button>)}</div><div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/dashboard/oauth">{copy.setup}</Link></Button><Button onClick={verifyMcp} disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{loading ? copy.checkingMcp : mode === "http" ? copy.checkHttp : copy.checkStdio}</Button></div></div>}
      {step === 3 && mcpCheck && <div className="space-y-5"><div className="flex items-center gap-3"><Check className="h-8 w-8 text-primary" /><h2 className="text-2xl font-semibold">{copy.final}</h2></div><p>{mcpCheck.detail}</p>{mcpCheck.issuer && <p className="break-all text-sm"><strong>OAuth issuer:</strong> <code>{mcpCheck.issuer}</code></p>}{mcpCheck.resource && <p className="break-all text-sm"><strong>MCP resource:</strong> <code>{mcpCheck.resource}</code></p>}{mode === "stdio" && <div><p className="font-medium">{copy.localCommands}</p><code className="mt-2 block whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">npm run mcp:check{"\n"}npm run mcp:test{"\n"}npm run mcp:start</code></div>}<p className="text-sm text-muted-foreground">{copy.after}</p><div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/dashboard/oauth">{copy.setup}</Link></Button><Button onClick={() => { setStep(2); setMcpCheck(null); }}>{copy.retry}</Button><Button onClick={() => router.push("/dashboard")}>{copy.dashboard} <ArrowRight className="ml-2 h-4 w-4" /></Button></div></div>}
      {error && <p role="alert" className="mt-5 rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
    </section>
  </div></main>;
}
