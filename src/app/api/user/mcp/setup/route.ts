import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { provisionManagedApiKey } from "@/lib/tenant-api-keys";
import { readBrowserTenantSelection, resolveTenantMembership } from "@/lib/tenancy/context";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

/**
 * Configure local stdio MCP for the signed-in user.
 * The generated bearer credential is returned only on first provisioning.
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    }

    try {
        const membership = await resolveTenantMembership(session.user.id, readBrowserTenantSelection(request));
        if (!membership) {
            return NextResponse.json({ status: false, message: "Tenant unavailable", error: "Tenant unavailable" }, { status: 403, headers: NO_STORE_HEADERS });
        }
        const result = await provisionManagedApiKey(membership.tenantId, session.user.id);

        return NextResponse.json({
            status: true,
            message: result.created ? "MCP API key generated" : "MCP API key already configured",
            data: result,
        }, { headers: NO_STORE_HEADERS });
    } catch {
        return NextResponse.json({ status: false, message: "Failed to configure MCP", error: "Failed to configure MCP" }, { status: 500, headers: NO_STORE_HEADERS });
    }
}
