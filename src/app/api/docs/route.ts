import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiDocs } from "@/lib/swagger";
import { isValidSwaggerAuthToken, SWAGGER_AUTH_COOKIE } from "@/lib/swagger-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SWAGGER_AUTH_COOKIE)?.value;
  if (!isValidSwaggerAuthToken(token)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const spec = getApiDocs();
  return NextResponse.json(spec, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
