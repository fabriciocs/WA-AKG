import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(6).max(128).optional(),
}).refine((data) => !data.newPassword || !!data.currentPassword, {
  message: "A senha atual é obrigatória para alterar a senha",
  path: ["currentPassword"],
});

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, name: true, email: true, role: true } });
  return account ? NextResponse.json({ data: account }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { name, currentPassword, newPassword } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { password: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (newPassword && !(await bcrypt.compare(currentPassword!, existing.password))) {
    return NextResponse.json({ error: "Senha atual inválida" }, { status: 400 });
  }
  await prisma.user.update({ where: { id: user.id }, data: { name, ...(newPassword ? { password: await bcrypt.hash(newPassword, 12) } : {}) } });
  return NextResponse.json({ status: true, data: { name } });
}
