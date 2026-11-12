'use client';

import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { saveFunction, type FunctionForm } from '@/app/[locale]/(app)/ajustes/carteiras/actions';
import { Badge } from '@/components/reui/badge';
import { SettingsSection } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/lib/i18n/client';

import { ReasonDialog } from './reason-dialog';

type Provider = 'anthropic' | 'deepseek' | 'gemini' | 'openai';

export interface StaffFunction {
  name: string;
  minCredits: number;
  permission: string;
  active: boolean;
  provider: Provider | null;
  model: string | null;
  effective: { provider: Provider; model: string };
  /** Provedores que a função já sabe chamar. */
  callable: Provider[];
}

/** Em ordem alfabética (regra das listas do app). */
const PROVIDERS: Provider[] = ['anthropic', 'deepseek', 'gemini', 'openai'];
/** Valor do seletor para "padrão da Cosmos" (o Select não aceita string vazia como item). */
const DEFAULT = 'default';
function FunctionDialog({
  fn,
  callableFor,
}: {
  fn?: StaffFunction;
  /** Funções que chamam modelo e os provedores de cada uma; as outras aceitam qualquer provedor. */
  callableFor: Record<string, Provider[]>;
}) {
  const { t } = useI18n();
  const T = t.cosmosStaff.functions;
  const router = useRouter();
  const id = useId();
  // cada abertura parte do que está salvo: o que foi digitado e cancelado não volta
  const initial = (): Omit<FunctionForm, 'reason'> => ({
    name: fn?.name ?? '',
    minCredits: fn?.minCredits ?? 0,
    permission: fn?.permission ?? '',
    provider: fn?.provider ?? '',
    model: fn?.model ?? '',
    active: fn?.active ?? true,
    create: !fn,
  });
  const [form, setForm] = useState(initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim() && form.permission.trim() && form.minCredits > 0;
  // provedor sem chamador nesta função aparece desligado: salvar deixaria a função "Ativa" sem responder
  const callable = fn?.callable ?? callableFor[form.name.trim()] ?? PROVIDERS;
  const providerItems = [
    { value: DEFAULT, label: T.defaultProvider, disabled: false },
    ...PROVIDERS.map((p) => ({
      value: p,
      label: callable.includes(p) ? T.providers[p] : `${T.providers[p]} · ${T.unavailable}`,
      disabled: !callable.includes(p),
    })),
  ];

  return (
    <ReasonDialog
      trigger={
        fn ? (
          <Button variant="ghost" size="icon-sm" aria-label={`${T.edit}: ${fn.name}`}>
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button size="sm">
            <Plus aria-hidden />
            {T.new}
          </Button>
        )
      }
      title={fn ? `${T.edit}: ${fn.name}` : T.new}
      description={T.description}
      canConfirm={Boolean(valid)}
      onOpen={() => setForm(initial())}
      onConfirm={async (reason) => {
        const r = await saveFunction({ ...form, reason });
        if (r.ok) router.refresh();
        return r;
      }}
    >
      {fn ? null : (
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>{T.name}</FieldLabel>
          <Input id={`${id}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} />
          <FieldDescription>{T.nameHint}</FieldDescription>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-min`}>{T.minCredits}</FieldLabel>
          <Input
            id={`${id}-min`}
            type="number"
            min={0.001}
            step={0.001}
            value={form.minCredits}
            onChange={(e) => set('minCredits', Number(e.target.value))}
          />
          <FieldDescription>{T.minCreditsHint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-permission`}>{T.permission}</FieldLabel>
          <Input
            id={`${id}-permission`}
            value={form.permission}
            onChange={(e) => set('permission', e.target.value)}
          />
          <FieldDescription>{T.permissionHint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-provider`}>{T.provider}</FieldLabel>
          <Select
            items={providerItems}
            value={form.provider || DEFAULT}
            onValueChange={(v) => {
              const next = v === DEFAULT || v === null ? '' : String(v);
              // outro provedor: o modelo do anterior não vale lá
              setForm((f) => ({ ...f, provider: next, model: next === f.provider ? f.model : '' }));
            }}
          >
            <SelectTrigger id={`${id}-provider`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providerItems.map((p) => (
                <SelectItem key={p.value} value={p.value} disabled={p.disabled}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-model`}>{T.model}</FieldLabel>
          <Input
            id={`${id}-model`}
            value={form.model}
            disabled={!form.provider}
            placeholder={T.modelPlaceholder}
            onChange={(e) => set('model', e.target.value)}
          />
          <FieldDescription>{T.modelHint}</FieldDescription>
        </Field>
        <Field orientation="horizontal" className="items-center">
          <Switch id={`${id}-active`} checked={form.active} onCheckedChange={(v) => set('active', v)} />
          <FieldLabel htmlFor={`${id}-active`}>{T.active}</FieldLabel>
        </Field>
      </div>
    </ReasonDialog>
  );
}

/** Catálogo de funções da Cosmos (#1088): mínimo, provedor e modelo de cada uma, ativas ou não. */
export function FunctionsSection({
  functions,
  callableFor,
}: {
  functions: StaffFunction[];
  /** Provedores que cada função que chama modelo sabe chamar (os outros aparecem indisponíveis no cadastro). */
  callableFor: Record<string, Provider[]>;
}) {
  const { t, locale } = useI18n();
  const T = t.cosmosStaff.functions;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  return (
    <SettingsSection
      title={T.title}
      description={T.description}
      action={<FunctionDialog callableFor={callableFor} />}
    >
      {functions.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.name}</TableHead>
              <TableHead>{T.provider}</TableHead>
              <TableHead>{T.model}</TableHead>
              <TableHead className="text-right">{T.minCredits}</TableHead>
              <TableHead>{T.active}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {functions.map((f) => (
              <TableRow key={f.name}>
                <TableCell className="font-mono text-xs">{f.name}</TableCell>
                <TableCell>
                  {T.providers[f.effective.provider]}
                  {f.provider ? null : (
                    <span className="text-muted-foreground text-xs"> · {T.defaultProvider}</span>
                  )}
                  {f.callable.includes(f.effective.provider) ? null : (
                    <Badge variant="warning-light" className="ms-2" title={T.unavailableHint}>
                      {T.unavailable}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{f.effective.model}</TableCell>
                <TableCell className="text-right tabular-nums">{n.format(f.minCredits)}</TableCell>
                <TableCell>
                  <Badge variant={f.active ? 'success-light' : 'secondary'}>
                    {f.active ? T.active : T.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <FunctionDialog fn={f} callableFor={callableFor} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">{T.empty}</p>
      )}
    </SettingsSection>
  );
}
