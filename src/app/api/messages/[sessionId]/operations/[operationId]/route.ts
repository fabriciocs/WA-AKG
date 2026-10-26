import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { getOperationReceipt } from "@/modules/messaging/outbound-message.service";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; operationId: string }> }
) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });

    const { sessionId, operationId } = await params;
    if (!await canAccessSession(user.id, user.role, sessionId)) {
        return NextResponse.json({ status: false, error: "Forbidden" }, { status: 403 });
    }

    const receipt = await getOperationReceipt({ operationId, userId: user.id, sessionId });
    if (!receipt) return NextResponse.json({ status: false, error: "Operation not found" }, { status: 404 });
    return NextResponse.json({ status: true, data: receipt });
}
