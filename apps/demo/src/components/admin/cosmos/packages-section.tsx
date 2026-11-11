'use client';

import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { savePackage, type PackageForm } from '@/app/[locale]/(app)/ajustes/carteiras/actions';
import { Badge } from '@/components/reui/badge';
import { SettingsSection } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { ReasonDialog } from './reason-dialog';

export interface StaffPackage {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  currency: 'brl' | 'usd';
  market: string;
  active: boolean;
  sortOrder: number;
}

const CURRENCIES = [
  { value: 'brl', label: 'BRL' },
  { value: 'usd', label: 'USD' },
];

function PackageDialog({ pkg }: { pkg?: StaffPackage }) {
  const { t } = useI18n();
  const T = t.cosmosStaff.packages;
  const router = useRouter();
  const id = useId();
  const [form, setForm] = useState<Omit<PackageForm, 'reason'>>(() => ({
    ...(pkg ? { id: pkg.id } : {}),
    name: pkg?.name ?? '',
    credits: pkg?.credits ?? 1000,
    price: pkg ? pkg.priceCents / 100 : 0,
    currency: pkg?.currency ?? 'brl',
    market: pkg?.market ?? 'BR',
    active: pkg?.active ?? true,
    sortOrder: pkg?.sortOrder ?? 0,
  }));
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid =
    form.name.trim() && form.credits > 0 && form.price > 0 && /^[A-Za-z]{2}$/.test(form.market.trim());

  return (
    <ReasonDialog
      trigger={
        pkg ? (
          <Button variant="ghost" size="icon-sm" aria-label={`${T.edit}: ${pkg.name}`}>
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button size="sm">
            <Plus aria-hidden />
            {T.new}
          </Button>
        )
      }
      title={pkg ? `${T.edit}: ${pkg.name}` : T.new}
      description={T.description}
      canConfirm={Boolean(valid)}
      onConfirm={async (reason) => {
        const r = await savePackage({ ...form, reason });
        if (r.ok) router.refresh();
        return r;
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>{T.name}</FieldLabel>
        <Input id={`${id}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-credits`}>{T.credits}</FieldLabel>
          <Input
            id={`${id}-credits`}
            type="number"
            min={1}
            value={form.credits}
            onChange={(e) => set('credits', Number(e.target.value))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-price`}>{T.price}</FieldLabel>
          <Input
            id={`${id}-price`}
            type="number"
            min={0.01}
            step={0.01}
            value={form.price}
            onChange={(e) => set('price', Number(e.target.value))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-currency`}>{T.currency}</FieldLabel>
          <Select
            items={CURRENCIES}
            value={form.currency}
            onValueChange={(v) => set('currency', v === 'usd' ? 'usd' : 'brl')}
          >
            <SelectTrigger id={`${id}-currency`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-market`}>{T.market}</FieldLabel>
          <Input
            id={`${id}-market`}
            maxLength={2}
            value={form.market}
            onChange={(e) => set('market', e.target.value.toUpperCase())}
          />
          <FieldDescription>{T.marketHint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-order`}>{T.order}</FieldLabel>
          <Input
            id={`${id}-order`}
            type="number"
            value={form.sortOrder}
            onChange={(e) => set('sortOrder', Number(e.target.value))}
          />
        </Field>
        <Field orientation="horizontal" className="items-center self-end">
          <Switch id={`${id}-active`} checked={form.active} onCheckedChange={(v) => set('active', v)} />
          <FieldLabel htmlFor={`${id}-active`}>{T.active}</FieldLabel>
        </Field>
      </div>
    </ReasonDialog>
  );
}

/** Gestão dos pacotes de créditos (todos os mercados, ativos ou não). */
export function PackagesSection({ packages }: { packages: StaffPackage[] }) {
  const { t, locale } = useI18n();
  const T = t.cosmosStaff.packages;
  const n = new Intl.NumberFormat(locale);
  const price = (p: StaffPackage) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency.toUpperCase() }).format(
      p.priceCents / 100,
    );
  return (
    <SettingsSection title={T.title} description={T.description} action={<PackageDialog />}>
      {packages.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.name}</TableHead>
              <TableHead>{T.market}</TableHead>
              <TableHead className="text-right">{T.credits}</TableHead>
              <TableHead className="text-right">{T.price}</TableHead>
              <TableHead>{T.active}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.market}</TableCell>
                <TableCell className="text-right tabular-nums">{n.format(p.credits)}</TableCell>
                <TableCell className="text-right tabular-nums">{price(p)}</TableCell>
                <TableCell>
                  <Badge variant={p.active ? 'success-light' : 'secondary'}>
                    {p.active ? T.active : T.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <PackageDialog pkg={p} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">{fill(T.empty, {})}</p>
      )}
    </SettingsSection>
  );
}
