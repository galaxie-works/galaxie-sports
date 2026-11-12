'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { ActionNotice, SettingsSection, UsageMeter } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { saveCosmosQuotas } from '@/lib/cosmos/quota-actions';
import type { CosmosQuotasData } from '@/lib/cosmos/quota-data';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { quotaScopeLabel } from './quota-scope';

interface Row {
  /** Chave estável da linha (tirar uma linha não troca o estado das outras). */
  key: number;
  scope: string;
  percent: string;
}

const toNumber = (v: string) => Number(v.trim().replace(',', '.'));
const QUOTAS_MAX = 50;

/** Soma das % das linhas válidas, com duas casas. */
export function quotaTotal(rows: readonly { percent: string }[]): number {
  const sum = rows.reduce((n, r) => {
    const v = toNumber(r.percent);
    return Number.isFinite(v) && v > 0 ? n + v : n;
  }, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Cotas da carteira por sala (#1116): o dono reparte o saldo do ciclo em %, vê o uso de cada cota, quanto ficou sem
 * destino e é avisado quando a soma passa de 100%. Sem `canManage`, só leitura. O servidor valida de novo ao salvar.
 */
export function CosmosQuotas({ data, canManage }: { data: CosmosQuotasData; canManage: boolean }) {
  const { t, locale } = useI18n();
  const T = t.cosmos.quotas;
  const router = useRouter();
  const ids = useId();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() =>
    data.quotas.map((q, key) => ({ key, scope: q.scope, percent: String(q.percent) })),
  );
  const [nextKey, setNextKey] = useState(data.quotas.length);
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const status = new Map(data.quotas.map((q) => [q.scope, q]));
  const total = quotaTotal(rows);
  const used = new Set(rows.map((r) => r.scope));
  const free = data.scopes.filter((s) => !used.has(s));
  const valid = rows.every((r) => {
    const v = toNumber(r.percent);
    return r.scope !== '' && Number.isFinite(v) && v > 0 && v <= 100;
  });

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () =>
    startTransition(async () => {
      const r = await saveCosmosQuotas(
        rows.map((row) => ({ scope: row.scope, percent: toNumber(row.percent) })),
      );
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(T.saved);
      router.refresh();
    });

  return (
    <SettingsSection
      title={T.title}
      description={canManage ? T.description : T.readOnly}
      action={
        canManage ? (
          <Button size="sm" disabled={pending || !valid} onClick={save}>
            {T.save}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {total > 100 ? (
          <ActionNotice tone="warning" title={T.overTitle}>
            {fill(T.over, { percent: n.format(total) })}
          </ActionNotice>
        ) : null}
        {rows.length === 0 ? <p className="text-muted-foreground text-sm">{T.empty}</p> : null}
        <ul className="flex flex-col gap-3">
          {rows.map((row, i) => {
            const s = status.get(row.scope);
            return (
              <li key={row.key} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Field className="min-w-48 flex-1">
                    <FieldLabel htmlFor={`${ids}-scope-${i}`}>{T.scope}</FieldLabel>
                    <Select
                      value={row.scope}
                      disabled={!canManage}
                      onValueChange={(scope) => update(i, { scope: scope ?? '' })}
                    >
                      <SelectTrigger id={`${ids}-scope-${i}`}>
                        <SelectValue placeholder={T.pickScope} />
                      </SelectTrigger>
                      <SelectContent>
                        {[row.scope, ...free]
                          .filter((v) => v !== '')
                          .map((v) => (
                            <SelectItem key={v} value={v}>
                              {quotaScopeLabel(T, v)}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field className="w-32">
                    <FieldLabel htmlFor={`${ids}-percent-${i}`}>{T.percent}</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id={`${ids}-percent-${i}`}
                        inputMode="decimal"
                        value={row.percent}
                        disabled={!canManage}
                        onChange={(e) => update(i, { percent: e.target.value })}
                      />
                      <InputGroupAddon align="inline-end">%</InputGroupAddon>
                    </InputGroup>
                  </Field>
                  {canManage ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={T.remove}
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
                {s ? (
                  <UsageMeter
                    label={fill(T.used, { used: n.format(s.used), credits: n.format(s.credits) })}
                    used={s.used}
                    total={s.credits}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            {fill(T.unassigned, { percent: n.format(Math.max(0, Math.round((100 - total) * 100) / 100)) })}
          </p>
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!free.length || rows.length >= QUOTAS_MAX}
              onClick={() => {
                setRows((prev) => [...prev, { key: nextKey, scope: '', percent: '' }]);
                setNextKey((k) => k + 1);
              }}
            >
              <Plus />
              {T.add}
            </Button>
          ) : null}
        </div>
      </div>
    </SettingsSection>
  );
}
