import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
    constantTimeStringEqual,
    createSwaggerAuthToken,
    getSwaggerCredentials,
    isValidSwaggerAuthToken,
    SWAGGER_AUTH_COOKIE,
    SWAGGER_AUTH_MAX_AGE_SECONDS,
} from "@/lib/swagger-auth";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
    const cookieStore = await cookies();
    const token = cookieStore.get(SWAGGER_AUTH_COOKIE)?.value;
    if (!isValidSwaggerAuthToken(token)) {
        return NextResponse.json({ authenticated: false }, { status: 401, headers: noStoreHeaders });
    }
    return NextResponse.json({ authenticated: true }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
    const credentials = getSwaggerCredentials();
    if (!credentials || !process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
        return NextResponse.json(
            { success: false, error: "Swagger authentication is not configured" },
            { status: 503, headers: noStoreHeaders },
        );
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { success: false, error: "Invalid request" },
            { status: 400, headers: noStoreHeaders },
        );
    }

    if (!body || typeof body !== "object") {
        return NextResponse.json(
            { success: false, error: "Invalid request" },
            { status: 400, headers: noStoreHeaders },
        );
    }

    const input = body as { username?: unknown; password?: unknown };
    if (
        typeof input.username !== "string"
        || typeof input.password !== "string"
        || !constantTimeStringEqual(input.username, credentials.username)
        || !constantTimeStringEqual(input.password, credentials.password)
    ) {
        return NextResponse.json(
            { success: false, error: "Invalid credentials" },
            { status: 401, headers: noStoreHeaders },
        );
    }

    const token = createSwaggerAuthToken();
    if (!token) {
        return NextResponse.json(
            { success: false, error: "Swagger authentication is not configured" },
            { status: 503, headers: noStoreHeaders },
        );
    }

    const response = NextResponse.json({ success: true }, { headers: noStoreHeaders });
    response.cookies.set({
        name: SWAGGER_AUTH_COOKIE,
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SWAGGER_AUTH_MAX_AGE_SECONDS,
    });
    return response;
}

export async function DELETE() {
    const response = NextResponse.json({ success: true }, { headers: noStoreHeaders });
    response.cookies.set({
        name: SWAGGER_AUTH_COOKIE,
        value: "",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    });
    return response;
}
