import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getManagedApiKey, provisionManagedApiKey, revokeManagedApiKey } from "@/lib/tenant-api-keys";
import { readBrowserTenantSelection, resolveTenantMembership } from "@/lib/tenancy/context";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

async function resolveKeyOwner(request: Request) {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return { ok: false, status: 401, message: "Unauthorized" } as const;
    const membership = await resolveTenantMembership(userId, readBrowserTenantSelection(request));
    if (!membership) return { ok: false, status: 403, message: "Tenant unavailable" } as const;
    return { ok: true, userId, tenantId: membership.tenantId } as const;
}

function keyError(message: string, status: number) {
    return NextResponse.json({ status: false, message, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request) {
    try {
        const owner = await resolveKeyOwner(request);
        if (!owner.ok) return keyError(owner.message, owner.status);
        const key = await getManagedApiKey(owner.tenantId, owner.userId);
        return NextResponse.json({
            status: true,
            message: "API key status fetched",
            data: {
                apiKey: null,
                configured: Boolean(key),
                prefix: key?.keyPrefix ?? null,
                createdAt: key?.createdAt ?? null,
                lastUsedAt: key?.lastUsedAt ?? null,
            },
        }, { headers: NO_STORE_HEADERS });
    } catch {
        return keyError("Failed to fetch API key", 500);
    }
}

export async function POST(request: Request) {
    try {
        const owner = await resolveKeyOwner(request);
        if (!owner.ok) return keyError(owner.message, owner.status);
        const { apiKey } = await provisionManagedApiKey(owner.tenantId, owner.userId, true);
        return NextResponse.json({ status: true, message: "API key generated", data: { apiKey } }, { headers: NO_STORE_HEADERS });
    } catch {
        return keyError("Failed to generate API key", 500);
    }
}

export async function DELETE(request: Request) {
    try {
        const owner = await resolveKeyOwner(request);
        if (!owner.ok) return keyError(owner.message, owner.status);
        await revokeManagedApiKey(owner.tenantId, owner.userId);
        return NextResponse.json({ status: true, message: "API key revoked" }, { headers: NO_STORE_HEADERS });
    } catch {
        return keyError("Failed to revoke API key", 500);
    }
}
