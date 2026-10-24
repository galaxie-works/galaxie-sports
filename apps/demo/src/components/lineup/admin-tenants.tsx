'use client';

import { Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveTenantOperator } from '@/app/[locale]/(app)/ajustes/grades/actions';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/lib/i18n/client';
import type { TenantOperatorRow } from '@/lib/lineup/server';

const NONE = '__none';

interface PlatformOption {
  id: string;
  name: string;
  country: string;
}

function TenantRow({ row, platforms }: { row: TenantOperatorRow; platforms: PlatformOption[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const T = t.lineup.admin.tenants;
  const [platformId, setPlatformId] = useState(row.platformId ?? NONE);
  const [domains, setDomains] = useState(row.emailDomains.join(', '));
  const [showOthers, setShowOthers] = useState(row.showOtherOperators);
  const [pending, startTransition] = useTransition();
  const items = [
    { value: NONE, label: T.none },
    ...platforms.map((p) => ({ value: p.id, label: `${p.name} · ${p.country}` })),
  ];
  const dirty =
    platformId !== (row.platformId ?? NONE) ||
    domains !== row.emailDomains.join(', ') ||
    showOthers !== row.showOtherOperators;

  const save = () =>
    startTransition(async () => {
      const res = await saveTenantOperator(row.tenant.id, {
        platformId: platformId === NONE ? null : platformId,
        domains,
        showOtherOperators: showOthers,
      });
      if (!res.ok) return void toast.error(res.error ?? t.lineup.errors.generic);
      toast.success(T.saved);
      router.refresh();
    });

  return (
    <TableRow>
      <TableCell>
        <span className="block font-medium">{row.tenant.name}</span>
        <span className="text-muted-foreground font-mono text-xs">{row.tenant.slug}</span>
        {row.tenant.status === 'suspended' ? (
          <Badge variant="warning-light" className="ml-1">
            {t.client.tenant.status.suspended}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="min-w-56">
        <Select items={items} value={platformId} onValueChange={(v) => setPlatformId(String(v ?? NONE))}>
          <SelectTrigger size="sm" className="w-full" aria-label={`${T.operator}: ${row.tenant.name}`}>
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
      </TableCell>
      <TableCell className="min-w-64">
        <Input
          className="h-7"
          spellCheck={false}
          aria-label={`${T.domains}: ${row.tenant.name}`}
          placeholder={T.domainsPlaceholder}
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Switch
          checked={showOthers}
          onCheckedChange={setShowOthers}
          aria-label={`${T.showOthers}: ${row.tenant.name}`}
        />
      </TableCell>
      <TableCell>
        <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={pending || !dirty} onClick={save}>
          {pending ? <Spinner /> : <Save />}
          {T.save}
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** Cadastro do tenant: operadora ligada, domínios de e-mail da operadora e outras operadoras na API. */
export function LineupTenants({
  rows,
  platforms,
}: {
  rows: TenantOperatorRow[];
  platforms: PlatformOption[];
}) {
  const { t } = useI18n();
  const T = t.lineup.admin.tenants;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground max-w-3xl text-sm">{T.description}</p>
      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T.tenant}</TableHead>
                <TableHead>{T.operator}</TableHead>
                <TableHead>{T.domains}</TableHead>
                <TableHead>{T.showOthers}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TenantRow key={row.tenant.id} row={row} platforms={platforms} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">{T.empty}</p>
      )}
    </div>
  );
}
