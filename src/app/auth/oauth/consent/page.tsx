import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { bindAuthorizationRequest } from "@/lib/oauth";
import { prisma } from "@/lib/prisma";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { requestBasePath, withBasePath } from "@/lib/base-path";

export const dynamic = "force-dynamic";

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<{ requestId?: string }> }) {
  const { requestId } = await searchParams;
  const session = await auth();
  const basePath = requestBasePath(await headers());
  if (!session?.user?.id) {
    const callbackUrl = withBasePath(`/auth/oauth/consent?requestId=${encodeURIComponent(requestId ?? "")}`, basePath);
    const login = new URLSearchParams({ callbackUrl });
    redirect(withBasePath(`/auth/login?${login.toString()}`, basePath));
  }
  const account = await prisma.user.findUnique({ where: { id: session.user.id }, select: { emailVerified: true } });
  if (!account?.emailVerified) redirect(withBasePath("/auth/login?emailVerificationRequired=1", basePath));
  const dashboardPath = withBasePath("/dashboard", basePath);
  if (!requestId) redirect(dashboardPath);
  const authorization = await bindAuthorizationRequest(requestId, session.user.id);
  if (!authorization) redirect(`${dashboardPath}?oauth_error=expired_request`);
  const t = await getTranslations("oauthConsent");
  const sessions = await prisma.session.findMany({
    where: session.user.role === "SUPERADMIN"
      ? {}
      : { OR: [{ userId: session.user.id }, { sessionAccesses: { some: { userId: session.user.id } } }] },
    select: { id: true, sessionId: true, name: true },
    orderBy: { name: "asc" },
  });
  const scopes = authorization.scope.split(/\s+/).filter(Boolean);

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12">
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">{t("eyebrow")}</p>
        <h1 className="mt-2 text-2xl font-semibold">{t("allowClient", { name: authorization.client.name })}</h1>
        {authorization.client.description && <p className="mt-2 text-sm text-muted-foreground">{authorization.client.description}</p>}
        <p className="mt-4 text-sm">{t("requesting")}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {scopes.map((scope) => <li key={scope}>{scope}</li>)}
        </ul>
        {scopes.some((scope) => scope.startsWith("mcp:") || scope.startsWith("api:")) && sessions.length > 0 && (
          <fieldset className="mt-5 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">{t("limitSessions")}</legend>
            <p className="mb-3 text-xs text-muted-foreground">{t("sessionHint")}</p>
            <div className="max-h-48 space-y-2 overflow-auto">
              {sessions.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="sessionIds" value={item.id} form="oauth-consent" />
                  <span>{item.name} <span className="text-muted-foreground">({item.sessionId})</span></span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <form id="oauth-consent" action={withBasePath("/api/oauth/authorize/decision", basePath)} method="post" className="mt-6 flex gap-3">
          <input type="hidden" name="requestId" value={requestId} />
          <button name="decision" value="deny" className="rounded-md border px-4 py-2 text-sm">{t("deny")}</button>
          <button name="decision" value="approve" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">{t("allow")}</button>
        </form>
      </section>
    </main>
  );
}
