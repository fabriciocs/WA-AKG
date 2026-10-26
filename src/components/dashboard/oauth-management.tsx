"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiUrl } from "@/lib/api-url";

type Client = { clientId: string; name: string; description: string | null; redirectUris: string[]; allowedScopes: string[]; grantTypes: string[]; isConfidential: boolean; isActive: boolean };
type Grant = { clientId: string; clientName: string; scope: string[]; sessionScope: string[] | null; createdAt: string };
const scopes = ["api:read", "api:write", "mcp:read", "mcp:write", "sessions:read"];

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description ?? data.error ?? `HTTP ${response.status}`);
  return data;
}

export default function OAuthManagement({ canManage }: { canManage: boolean }) {
  const t = useTranslations("oauth");
  const [clients, setClients] = useState<Client[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [name, setName] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["mcp:read", "api:read", "sessions:read"]);
  const [createdClientId, setCreatedClientId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const grantResult = await fetch(apiUrl("/api/oauth/grants"), { cache: "no-store" }).then(readJson);
    setGrants(grantResult);
    if (canManage) setClients(await fetch(apiUrl("/api/oauth/clients"), { cache: "no-store" }).then(readJson));
  }, [canManage]);

  useEffect(() => { reload().catch(() => setMessage(t("loadError"))); }, [reload, t]);

  async function createClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setCreatedClientId("");
    try {
      const result = await fetch(apiUrl("/api/oauth/clients"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, redirectUris: redirectUri ? [redirectUri] : [], allowedScopes: selectedScopes, grantTypes: ["authorization_code", "refresh_token"], isConfidential: false }),
      }).then(readJson);
      setCreatedClientId(result.client.clientId);
      setMessage(t("clientCreated", { name: result.client.name }));
      setName(""); setRedirectUri(""); await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("createError")); }
    finally { setBusy(false); }
  }

  async function toggleClient(client: Client) {
    setBusy(true);
    try {
      await fetch(apiUrl(`/api/oauth/clients/${encodeURIComponent(client.clientId)}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !client.isActive }) }).then(readJson);
      await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("updateError")); }
    finally { setBusy(false); }
  }

  async function revokeGrant(clientId: string) {
    setBusy(true);
    try {
      await fetch(apiUrl(`/api/oauth/grants/${encodeURIComponent(clientId)}`), { method: "DELETE" }).then(readJson);
      setMessage(t("accessRevoked")); await reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("revokeError")); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 md:p-10">
      <header><p className="text-sm text-muted-foreground">{t("security")}</p><h1 className="text-3xl font-semibold">{t("title")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p></header>
      {message && <p role="status" className="rounded-md border p-3 text-sm">{message}</p>}
      {createdClientId && <p className="break-all rounded-md border border-primary p-3 text-sm">{t("clientId")}: <code>{createdClientId}</code></p>}

      <section className="space-y-3">
        <h2 className="text-xl font-medium">{t("connectedClients")}</h2>
        {grants.length === 0 ? <p className="text-sm text-muted-foreground">{t("noActiveGrants")}</p> : grants.map((grant) => (
          <article key={grant.clientId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div><h3 className="font-medium">{grant.clientName}</h3><p className="text-sm text-muted-foreground">{grant.scope.join(" ")}</p><p className="text-xs text-muted-foreground">{grant.sessionScope ? t("limitedSessions", { count: grant.sessionScope.length }) : t("allSessions")}</p></div>
            <button disabled={busy} onClick={() => revokeGrant(grant.clientId)} className="rounded-md border px-3 py-2 text-sm">{t("revokeAccess")}</button>
          </article>
        ))}
      </section>

      {canManage && <section className="space-y-4">
        <h2 className="text-xl font-medium">{t("clients")}</h2>
        <form onSubmit={createClient} className="space-y-4 rounded-lg border p-4">
          <label className="block text-sm">{t("clientName")}<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
          <label className="block text-sm">{t("redirectUri")}<input required type="url" value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} placeholder={t("redirectPlaceholder")} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
          <fieldset><legend className="text-sm font-medium">{t("allowedScopes")}</legend><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{scopes.map((scope) => <label key={scope} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedScopes.includes(scope)} onChange={(event) => setSelectedScopes((items) => event.target.checked ? [...items, scope] : items.filter((item) => item !== scope))} />{scope}</label>)}</div></fieldset>
          <p className="text-xs text-muted-foreground">{t("mcpReadHint")}</p>
          <p className="text-xs text-muted-foreground">{t("mcpWriteHint")}</p>
          <p className="text-xs text-muted-foreground">{t("publicClientHint")}</p>
          <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">{busy ? t("creatingClient") : t("createClient")}</button>
        </form>
        <div className="space-y-2">{clients.map((client) => <article key={client.clientId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><h3 className="font-medium">{client.name}</h3><p className="break-all font-mono text-xs text-muted-foreground">{client.clientId}</p><p className="text-xs text-muted-foreground">{client.isActive ? t("active") : t("disabled")} · {client.allowedScopes.join(" ")}</p></div><button disabled={busy} onClick={() => toggleClient(client)} className="rounded-md border px-3 py-2 text-sm">{client.isActive ? t("disable") : t("enable")}</button></article>)}</div>
      </section>}
    </main>
  );
}
