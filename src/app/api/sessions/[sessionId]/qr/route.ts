import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, isSessionOwner } from "@/lib/api-auth";
import QRCode from "qrcode";

// GET: Get QR code for session
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // Pairing QR codes can link a new WhatsApp device and are owner-only.
        const isOwner = await isSessionOwner(user.id, user.role, sessionId);
        if (!isOwner) {
            return NextResponse.json({ status: false, message: "Forbidden - Only the session owner can view the QR code", error: "Forbidden" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const qr = instance.qr; // Access qr property directory
        
        if (!qr) {
            // Check connection status
            if (instance.socket?.user) {
                return NextResponse.json({ 
                    error: "Already connected",
                    connected: true
                }, { status: 400 });
            }
            
            return NextResponse.json({ 
                error: "QR code not available. Session may be connecting...",
                qr: null
            }, { status: 404 });
        }

        // Generate base64 QR code image
        const base64QR = await QRCode.toDataURL(qr);

        return NextResponse.json({ 
            success: true,
            qr: qr,
            base64: base64QR
        });

    } catch (error) {
        console.error("Get QR error:", error);
        return NextResponse.json({ status: false, message: "Failed to get QR code", error: "Failed to get QR code" }, { status: 500 });
    }
}
