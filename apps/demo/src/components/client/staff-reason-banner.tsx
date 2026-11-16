'use client';

import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { StaffReasonDialog } from './tenant-switcher';

/**
 * Para a equipe Galaxie num tenant de cliente (PL17): o motivo em vigor (e o botão para trocar) ou o aviso de que
 * nenhuma escrita passa até informar um.
 */
export function StaffReasonBanner({
  tenant,
  reason,
}: {
  tenant: { id: string; name: string };
  reason: string | null;
}) {
  const { t } = useI18n();
  const s = t.client.staff;
  const [open, setOpen] = useState(false);
  return (
    <>
      <Alert variant={reason ? 'info' : 'warning'}>
        <ShieldAlert />
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{reason ? fill(s.acting, { reason }) : s.missing}</span>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {reason ? s.change : s.inform}
          </Button>
        </AlertDescription>
      </Alert>
      <StaffReasonDialog open={open} tenant={tenant} onOpenChange={setOpen} />
    </>
  );
}
