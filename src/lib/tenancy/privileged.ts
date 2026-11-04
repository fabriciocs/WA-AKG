import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requestPublicOrigin } from "@/lib/base-path";
import { checkOAuthRateLimitDistributed } from "@/lib/oauth/dcr-rate-limit";
import { prisma } from "@/lib/prisma";
import { decideTenantAccess, type TenantAction } from "@/lib/tenant-policy";
import { adminTotpClaimId, verifyAdminTotp } from "./privileged-totp";

type AdministrativeOperation = {
  name: string;
  action: TenantAction;
  tenantId?: string;
};

type AdministrativeResult = {
  status?: number;
  data: unknown;
  tenantId?: string;
};

function response(data: unknown, status: number, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers: { ...headers, "Cache-Control": "no-store" } });
}

function totpSecretFor(userId: string): string | null {
  try {
    const map: unknown = JSON.parse(process.env.WA_AKG_ADMIN_TOTP_KEYS ?? "{}");
    if (!map || typeof map !== "object" || !Object.hasOwn(map, userId)) return null;
    const secret = (map as Record<string, unknown>)[userId];
    return typeof secret === "string" ? secret : null;
  } catch {
    return null;
  }
}

export async function withPrivilegedAdministration(
  request: Request,
  operation: AdministrativeOperation,
  perform: (tx: Prisma.TransactionClient) => Promise<AdministrativeResult>,
) {
  if (request.headers.has("authorization") || request.headers.has("x-api-key")) {
    return response({ error: "browser_session_required" }, 403);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== requestPublicOrigin(request.headers, request.url)) {
    return response({ error: "forbidden" }, 403);
  }

  const userId = (await auth())?.user?.id;
  if (!userId) return response({ error: "unauthorized" }, 401);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, emailVerified: true } });
  if (user?.role !== "SUPERADMIN" || !user.emailVerified) return response({ error: "forbidden" }, 403);

  const reason = request.headers.get("x-wa-akg-admin-reason")?.trim();
  const code = request.headers.get("x-wa-akg-admin-totp") ?? "";
  if (!reason || reason.length < 5 || reason.length > 240 || !/^[0-9]{6}$/.test(code)) {
    return response({ error: "mfa_and_reason_required" }, 400);
  }

  const now = Date.now();
  const rateLimit = await checkOAuthRateLimitDistributed(
    "platform-mfa",
    createHash("sha256").update(userId).digest("hex"),
    { limit: 10, windowMs: 5 * 60_000 },
    now,
  );
  if (!rateLimit.allowed) return response({ error: "mfa_rate_limited" }, 429, { "Retry-After": String(rateLimit.retryAfterSeconds) });
  const secret = totpSecretFor(userId);
  const step = secret ? verifyAdminTotp(secret, code, now) : null;
  if (step === null) return response({ error: "mfa_verification_failed" }, 403);

  const requestId = randomUUID();
  const id = adminTotpClaimId(userId, step);
  const headers = { "x-request-id": requestId };
  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.user.findUnique({ where: { id: userId }, select: { role: true, emailVerified: true } });
      if (account?.role !== "SUPERADMIN" || !account.emailVerified) return response({ error: "forbidden" }, 403, headers);
      const target = operation.tenantId ? await tx.tenant.findUnique({
        where: { id: operation.tenantId }, select: { id: true },
      }) : null;
      if (target && !decideTenantAccess({
        actor: { userId, platformRole: "SUPERADMIN", authMethod: "session", tenantId: target.id, tenantRole: null, membershipStatus: null },
        resource: { tenantId: target.id },
        action: operation.action,
        privilegedAccess: { mfaVerified: true, reason, requestId, auditReady: true },
      }).allowed) return response({ error: "forbidden" }, 403, headers);

      const claim = await tx.adminAccessEvent.createMany({
        data: {
          id, actorUserId: userId, tenantId: target?.id, action: operation.name, reason, requestId,
          resourceType: "Tenant", resourceId: operation.tenantId, outcome: "DENIED",
        },
        skipDuplicates: true,
      });
      if (!claim.count) return response({ error: "mfa_code_already_used" }, 403, headers);

      const result = operation.tenantId && !target
        ? { status: 404, data: { error: "not_found" } }
        : await perform(tx);
      const status = result.status ?? 200;
      await tx.adminAccessEvent.update({
        where: { id },
        data: { outcome: status < 400 ? "ALLOWED" : "DENIED", ...(result.tenantId ? { tenantId: result.tenantId, resourceId: result.tenantId } : {}) },
      });
      return response(result.data, status, headers);
    });
  } catch {
    return response({ error: "privileged_operation_unavailable" }, 503, headers);
  }
}
