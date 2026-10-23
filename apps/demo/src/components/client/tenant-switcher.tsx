'use client';

import { Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { selectTenant } from '@/app/[locale]/(app)/cliente/actions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TenantOption } from '@/lib/client/tenants';
import { useI18n } from '@/lib/i18n/client';

/** Só para o admin: qual tenant acompanhar no painel do cliente (o cliente fica sempre no dele). */
export function TenantSwitcher({ tenants, value }: { tenants: TenantOption[]; value: string | null }) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const items = tenants.map((x) => ({ value: x.id, label: x.name }));
  return (
    <div className="flex items-center gap-2">
      <Building2 className="text-muted-foreground size-4" aria-hidden />
      <Select
        items={items}
        value={value}
        disabled={pending}
        onValueChange={(v) =>
          v &&
          startTransition(async () => {
            const res = await selectTenant(String(v));
            if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
            toast.success(t.client.tenant.switched);
            router.refresh();
          })
        }
      >
        <SelectTrigger className="w-56" aria-label={t.client.tenant.viewing}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
