'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { selectTenant } from '@/app/[locale]/(app)/client/actions';
import { StaffReasonDialog } from '@/components/client/tenant-switcher';
import { Button } from '@/components/ui/button';
import type { TenantOption } from '@/lib/client/tenants';
import { useI18n } from '@/lib/i18n/client';

const PLANS = '/client/plans';

/**
 * "Abrir Planos e módulos" do aviso do chat (#1389) sempre no tenant da chave da demo: Planos e módulos age sobre o
 * tenant em foco no painel, e abrir com outra marca em foco ligaria o módulo no cliente errado. Já em foco, é só o link;
 * senão, põe a marca em foco antes (com o motivo da equipe, PL17, quando a marca é de cliente) e só então abre.
 */
export function OpenDemoPlans({
  tenant,
  focused,
  label,
}: {
  tenant: Pick<TenantOption, 'id' | 'name' | 'isGalaxie'>;
  focused: boolean;
  label: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  if (focused)
    return (
      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={PLANS} />}>
        {label}
      </Button>
    );
  const open = () => router.push(PLANS);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!tenant.isGalaxie) return void setAsking(true);
          startTransition(async () => {
            const res = await selectTenant(tenant.id);
            if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
            open();
          });
        }}
      >
        {label}
      </Button>
      {tenant.isGalaxie ? null : (
        <StaffReasonDialog open={asking} tenant={tenant} onOpenChange={setAsking} onDone={open} />
      )}
    </>
  );
}
