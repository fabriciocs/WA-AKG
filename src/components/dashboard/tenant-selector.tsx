"use client";

import { useState } from "react";

type TenantOption = { id: string; name: string };

export function TenantSelector({ tenants, selected, endpoint }: {
  tenants: TenantOption[];
  selected: string | null;
  endpoint: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function selectTenant(tenantId: string) {
    if (!tenantId) return;
    setPending(true);
    setError(false);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "x-tenant-id": tenantId } });
      if (!response.ok) throw new Error("Tenant selection failed");
      window.location.reload();
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
      <label htmlFor="active-tenant" className="text-sm">Tenant ativo</label>
      <select
        id="active-tenant"
        value={selected ?? ""}
        disabled={pending}
        onChange={(event) => void selectTenant(event.target.value)}
        className="max-w-full rounded-md border bg-background px-2 py-1 text-sm"
      >
        <option value="" disabled>Selecione um tenant</option>
        {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
      </select>
      {error && <span role="alert" className="text-sm text-destructive">Não foi possível selecionar o tenant.</span>}
    </div>
  );
}
