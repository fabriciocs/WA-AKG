import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { approveAuthorizationRequest, bindAuthorizationRequest, denyAuthorizationRequest, OAuthError } from "@/lib/oauth";
import { InvalidSessionCapabilityError, normalizeSessionCapabilities, parseSubmittedSessionCapabilities, type SessionCapabilityMap } from "@/lib/oauth/grant-capabilities";
import { authorizationRedirectWithIssuer, oauthIssuer } from "@/lib/oauth/discovery.mjs";
import { prisma } from "@/lib/prisma";
import { requestBasePath, requestPublicOrigin } from "@/lib/base-path";
import { readBrowserTenantSelection, resolveTenantMembership } from "@/lib/tenancy/context";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const account = await prisma.user.findUnique({ where: { id: session.user.id }, select: { emailVerified: true } });
  if (!account?.emailVerified) return NextResponse.json({ error: "email_not_verified" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== requestPublicOrigin(request.headers, request.url)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const form = await request.formData();
    const requestId = String(form.get("requestId") ?? "");
    const decision = String(form.get("decision") ?? "");
    if (!requestId || !["approve", "deny"].includes(decision)) throw new OAuthError("Invalid authorization decision");
    const membership = await resolveTenantMembership(session.user.id, readBrowserTenantSelection(request));
    if (!membership) throw new OAuthError("Tenant unavailable", "access_denied", 403);
    const authorization = await bindAuthorizationRequest(requestId, session.user.id, membership.tenantId);
    if (!authorization) throw new OAuthError("Authorization request expired", "invalid_request", 400);
    let result: { redirectUri: string; state: string | null; code?: string };
    if (decision === "deny") {
      result = await denyAuthorizationRequest(requestId, session.user.id);
    } else {
      const submittedIds = form.getAll("sessionIds").map(String);
      let submittedCapabilities: SessionCapabilityMap | undefined;
      try {
        const entries = [
          ...form.getAll("sessionCapability").map(String),
          ...Array.from(form.entries())
            .filter(([key]) => key.startsWith("sessionCapability-"))
            .map(([key, value]) => `${key.slice("sessionCapability-".length)}:${String(value)}`),
        ];
        submittedCapabilities = parseSubmittedSessionCapabilities(
          form.get("sessionCapabilities") === null ? null : String(form.get("sessionCapabilities")),
          entries,
        );
      } catch (error) {
        if (error instanceof InvalidSessionCapabilityError) throw new OAuthError(error.message, "invalid_scope", 400);
        throw error;
      }
      let capabilities: SessionCapabilityMap;
      try {
        capabilities = normalizeSessionCapabilities(submittedIds, submittedCapabilities);
      } catch (error) {
        if (error instanceof InvalidSessionCapabilityError) throw new OAuthError(error.message, "invalid_scope", 400);
        throw error;
      }
      const approved = await approveAuthorizationRequest(requestId, session.user.id, submittedIds, capabilities);
      result = approved;
    }
    const basePath = requestBasePath(request.headers);
    const issuer = oauthIssuer({
      configuredIssuer: process.env.OAUTH_ISSUER_URL,
      configuredOrigin: process.env.BASE_URL,
      requestOrigin: requestPublicOrigin(request.headers, request.url),
      basePath,
    });
    const redirect = authorizationRedirectWithIssuer(result.redirectUri, issuer);
    redirect.searchParams.set("state", result.state ?? "");
    if (result.code) redirect.searchParams.set("code", result.code);
    else { redirect.searchParams.set("error", "access_denied"); redirect.searchParams.set("error_description", "The user denied the request"); }
    return NextResponse.redirect(redirect, { status: 303, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    const status = error instanceof OAuthError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "OAuth request failed" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
