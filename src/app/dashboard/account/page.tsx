"use client";
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function AccountProfilePage() {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [role, setRole] = useState("");
  const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { fetch(apiUrl("/api/account/profile")).then(r => r.json()).then(({ data }) => { if (data) { setName(data.name || ""); setEmail(data.email); setRole(data.role); } }); }, []);
  async function save(event: React.FormEvent) { event.preventDefault(); setSaving(true); try { const response = await fetch(apiUrl("/api/account/profile"), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, currentPassword: currentPassword || undefined, newPassword: newPassword || undefined }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); toast.success("Perfil atualizado"); setCurrentPassword(""); setNewPassword(""); } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o perfil"); } finally { setSaving(false); } }
  return <div className="max-w-2xl space-y-6"><div><h1 className="text-2xl font-bold">Meu perfil</h1><p className="text-muted-foreground">Altere seu nome e sua senha. E-mail e perfil de acesso não podem ser alterados aqui.</p></div><Card><CardHeader><CardTitle>Dados da conta</CardTitle><CardDescription>O e-mail e o perfil de acesso são somente leitura.</CardDescription></CardHeader><CardContent><form onSubmit={save} className="space-y-5"><div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} required maxLength={120} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>E-mail</Label><Input value={email} readOnly disabled /></div><div className="space-y-2"><Label>Perfil de acesso</Label><Input value={role} readOnly disabled /></div></div><div className="border-t pt-5 space-y-4"><h2 className="font-medium">Alterar senha</h2><div className="space-y-2"><Label>Senha atual</Label><Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" /></div><div className="space-y-2"><Label>Nova senha</Label><Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} autoComplete="new-password" /><p className="text-xs text-muted-foreground">Deixe em branco para manter a senha atual.</p></div></div><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}</Button></form></CardContent></Card></div>;
}
