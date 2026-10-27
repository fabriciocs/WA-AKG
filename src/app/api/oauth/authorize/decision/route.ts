import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { approveAuthorizationRequest, bindAuthorizationRequest, denyAuthorizationRequest, OAuthError } from "@/lib/oauth";
import { authorizationRedirectWithIssuer, normalizeBasePath, oauthIssuer } from "@/lib/oauth/discovery.mjs";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const account = await prisma.user.findUnique({ where: { id: session.user.id }, select: { emailVerified: true } });
  if (!account?.emailVerified) return NextResponse.json({ error: "email_not_verified" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const form = await request.formData();
    const requestId = String(form.get("requestId") ?? "");
    const decision = String(form.get("decision") ?? "");
    if (!requestId || !["approve", "deny"].includes(decision)) throw new OAuthError("Invalid authorization decision");
    const authorization = await bindAuthorizationRequest(requestId, session.user.id);
    if (!authorization) throw new OAuthError("Authorization request expired", "invalid_request", 400);
    let result: { redirectUri: string; state: string | null; code?: string };
    if (decision === "deny") {
      result = await denyAuthorizationRequest(requestId, session.user.id);
    } else {
      const submittedIds = form.getAll("sessionIds").map(String);
      const accessible = await prisma.session.findMany({
        where: session.user.role === "SUPERADMIN"
          ? { id: { in: submittedIds } }
          : { id: { in: submittedIds }, OR: [{ userId: session.user.id }, { sessionAccesses: { some: { userId: session.user.id } } }] },
        select: { id: true },
      });
      if (accessible.length !== new Set(submittedIds).size) throw new OAuthError("One or more selected sessions are not accessible", "access_denied", 403);
      const approved = await approveAuthorizationRequest(requestId, session.user.id, accessible.map((item) => item.id));
      result = approved;
    }
    const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH || request.nextUrl.basePath || "");
    const issuer = oauthIssuer({
      configuredIssuer: process.env.OAUTH_ISSUER_URL,
      configuredOrigin: process.env.BASE_URL,
      requestOrigin: request.nextUrl.origin,
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
