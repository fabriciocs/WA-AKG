import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/lib/email-verification";

const schema = z.object({ email: z.string().trim().email().max(254) });
const genericResponse = { message: "If the account needs verification, an email will be sent shortly." };

export async function POST(request: Request) {
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json(genericResponse, { status: 200, headers: { "Cache-Control": "no-store" } });
  const user = await prisma.user.findUnique({ where: { email: body.data.email.toLowerCase() }, select: { id: true, email: true, name: true, emailVerified: true } });
  if (user && !user.emailVerified) {
    try {
      await sendVerificationEmail(user, new URL(request.url));
    } catch (error) {
      console.error("Verification email resend failed", error instanceof Error ? error.name : "unknown");
      return NextResponse.json({ error: "Email delivery is temporarily unavailable. Please try again later." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  return NextResponse.json(genericResponse, { status: 200, headers: { "Cache-Control": "no-store" } });
}
