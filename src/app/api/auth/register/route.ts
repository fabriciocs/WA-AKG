import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sendVerificationEmail } from "@/lib/email-verification";
import { requestBasePath } from "@/lib/base-path";

const registerSchema = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    password: z.string().min(6).max(128),
});

export async function POST(req: Request) {
    let submittedEmail = "";
    try {
        const parsed = registerSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: "Invalid registration data provided" }, { status: 400 });
        const { name, password } = parsed.data;
        const email = parsed.data.email.toLowerCase();
        submittedEmail = email;

        const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        const registrationEnabled = process.env.PUBLIC_REGISTRATION === "true" || systemConfig?.enableRegistration === true;
        if (!registrationEnabled) {
            return NextResponse.json({ error: "Registration is currently disabled by the administrator" }, { status: 403 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await prisma.user.create({
            data: { name, email, password: hashedPassword, role: "USER", emailVerified: false },
            select: { id: true, name: true, email: true },
        });

        try {
            await sendVerificationEmail(newUser, new URL(req.url), undefined, requestBasePath(req.headers));
        } catch (error) {
            console.error("Verification email delivery failed", error instanceof Error ? error.name : "unknown");
            return NextResponse.json({ error: "Account created, but the verification email could not be sent. Use resend verification to try again." }, { status: 503 });
        }

        return NextResponse.json({ success: true, message: "If this address can be registered, a verification email will be sent." }, { status: 202 });
    } catch (error: unknown) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid registration data provided" }, { status: 400 });
        }
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
            const existing = await prisma.user.findUnique({ where: { email: submittedEmail }, select: { id: true, email: true, name: true, emailVerified: true } });
            if (existing && !existing.emailVerified) {
                try { await sendVerificationEmail(existing, new URL(req.url), undefined, requestBasePath(req.headers)); } catch { /* Keep the response indistinguishable; the resend endpoint supports recovery. */ }
            }
            return NextResponse.json({ success: true, message: "If this address can be registered, a verification email will be sent." }, { status: 202 });
        }
        console.error("Registration error:", error instanceof Error ? error.name : "unknown");
        return NextResponse.json({ error: "Internal server error during registration" }, { status: 500 });
    }
}
