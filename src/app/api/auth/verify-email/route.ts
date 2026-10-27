import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeVerificationToken } from "@/lib/email-verification";

const schema = z.object({ token: z.string().min(40).max(64) });

export async function POST(request: Request) {
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "This verification link is invalid or expired." }, { status: 400 });
  const result = await consumeVerificationToken(body.data.token);
  if (result === "verified" || result === "already-verified") {
    return NextResponse.json({ success: true, alreadyVerified: result === "already-verified" }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: "This verification link is invalid or expired. Request a new one and try again." }, { status: 400, headers: { "Cache-Control": "no-store" } });
}
