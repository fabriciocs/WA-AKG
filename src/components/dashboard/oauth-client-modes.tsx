"use client";

import { useLocale } from "next-intl";
import Link from "@/components/app-link";

const translations = {
  en: {
    title: "Three ways to register an OAuth client",
    note: "All methods use Authorization Code + PKCE S256, explicit consent and session permissions.",
    cimd: "Client ID Metadata Document (CIMD)",
    cimdBody: "The MCP client publishes its own HTTPS metadata JSON. The URL becomes its client_id and is validated when authorizing.",
    dcr: "Dynamic Client Registration (DCR)",
    dcrBody: "The MCP client discovers the registration_endpoint and registers automatically. New clients start with read-only permissions.",
    manual: "Pre-registered client",
    manualBody: "A SUPERADMIN creates a client with the exact redirect URI and shares its client_id with the MCP client. Use the form below.",
    discovery: "Open OAuth server discovery",
    guided: "Back to onboarding",
  },
  "pt-BR": {
    title: "Três formas de registrar um cliente OAuth",
    note: "Todas utilizam Authorization Code + PKCE S256, consentimento explícito e permissões por sessão.",
    cimd: "Documento de metadados (CIMD)",
    cimdBody: "O cliente MCP publica seu próprio JSON em HTTPS. A URL é seu client_id e é validada no momento da autorização.",
    dcr: "Registro dinâmico (DCR)",
    dcrBody: "O cliente MCP descobre o registration_endpoint e se registra automaticamente. Novos clientes começam com permissões de leitura.",
    manual: "Cliente pré-registrado",
    manualBody: "Um SUPERADMIN cria o cliente com a URL exata de retorno e fornece o client_id ao cliente MCP. Use o formulário abaixo.",
    discovery: "Abrir discovery OAuth",
    guided: "Voltar ao onboarding",
  },
  id: {
    title: "Tiga cara mendaftarkan klien OAuth",
    note: "Semua metode memakai Authorization Code + PKCE S256, persetujuan eksplisit, dan izin per sesi.",
    cimd: "Dokumen Metadata Client ID (CIMD)",
    cimdBody: "Klien MCP menerbitkan JSON metadata HTTPS; URL menjadi client_id dan diverifikasi selama otorisasi.",
    dcr: "Pendaftaran Klien Dinamis (DCR)",
    dcrBody: "Klien MCP menemukan registration_endpoint dan mendaftar otomatis. Klien baru diawali dengan izin baca.",
    manual: "Klien terdaftar sebelumnya",
    manualBody: "SUPERADMIN membuat klien dengan redirect URI yang tepat dan membagikan client_id. Gunakan formulir di bawah.",
    discovery: "Buka penemuan OAuth",
    guided: "Kembali ke onboarding",
  },
} as const;

export function OAuthClientModes() {
  const locale = useLocale();
  const t = translations[locale as keyof typeof translations] ?? translations.en;
  return (
    <section className="space-y-4 rounded-xl border p-5" aria-labelledby="oauth-client-modes">
      <div>
        <h2 id="oauth-client-modes" className="text-xl font-semibold">{t.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t.note}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {([
          [t.cimd, t.cimdBody],
          [t.dcr, t.dcrBody],
          [t.manual, t.manualBody],
        ] as const).map(([title, body]) => (
          <article key={title} className="rounded-lg border p-4">
            <h3 className="font-medium">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/.well-known/oauth-authorization-server" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">{t.discovery}</Link>
        <Link href="/onboarding" className="font-medium underline underline-offset-4">{t.guided}</Link>
      </div>
    </section>
  );
}
