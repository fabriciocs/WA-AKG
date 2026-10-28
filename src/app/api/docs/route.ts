import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getApiDocs } from "@/lib/swagger";
import { getBrandConfig } from "@/lib/branding-server";
import { isValidSwaggerAuthToken, SWAGGER_AUTH_COOKIE } from "@/lib/swagger-auth";
import { getAuthenticatedUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SWAGGER_AUTH_COOKIE)?.value;
  const swaggerAuthenticated = isValidSwaggerAuthToken(token);
  const user = swaggerAuthenticated ? null : await getAuthenticatedUser(request);

  if (!swaggerAuthenticated && !user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const brand = await getBrandConfig();
  const spec = getApiDocs(brand);
  return NextResponse.json(spec, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
