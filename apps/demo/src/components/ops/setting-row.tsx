'use client';

import { nextCronRuns, settingDef, validateSetting, type SettingDef } from '@galaxie/runtime-config';
import { RotateCcw, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  resetSetting,
  saveSetting,
  type OpsActionResult,
} from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { Badge } from '@/components/reui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSetting } from '@/lib/ops/types';
import { validationMessage } from '@/lib/ops/validation-message';
import { cn } from '@/lib/utils';

import { displayValue, optionLabel, settingText } from './format';

/** Roda uma ação do servidor com toast e atualiza a página. */
export function useOpsAction() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<OpsActionResult>, ok: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? t.ops.feedback.failed);
      if (res.warning) toast.warning(res.warning);
      else toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

const SOURCE_VARIANT = {
  db: 'primary-light',
  env: 'info-light',
  default: 'secondary',
} as const;

export function SourceBadge({ source }: { source: OpsSetting['source'] }) {
  const { t } = useI18n();
  return (
    <Badge variant={SOURCE_VARIANT[source]} title={t.ops.source.label}>
      {t.ops.source[source]}
    </Badge>
  );
}

export interface SettingRowProps {
  setting: OpsSetting;
  timeZone: string;
  /** Instante da leitura (ISO): base dos "há X min" (igual no servidor e na hidratação). */
  now: string;
  /** Plano padrão efetivo (para "herdar" nos planos por API). */
  inheritPlan?: string | null;
  /** Informação extra à esquerda (ex.: última execução do job). */
  aside?: React.ReactNode;
  /** Ações extras à direita (ex.: rodar agora). */
  actions?: React.ReactNode;
}

/** Texto do controle a partir do valor efetivo (vazio/nulo vira campo vazio). */
const initialDraft = (s: OpsSetting) => s.value ?? '';

export function SettingRow({ setting, timeZone, now, inheritPlan, aside, actions }: SettingRowProps) {
  const def = settingDef(setting.key)!;
  const { t, locale } = useI18n();
  const f = useFormatters(timeZone);
  const T = t.ops;
  const text = settingText(T, def);
  const [draft, setDraft] = useState(initialDraft(setting));
  const [preview, setPreview] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);
  const { pending, run } = useOpsAction();

  const checked = validateSetting(def, draft);
  const normalized = checked.ok ? checked.value : draft;
  const dirty = normalized !== (setting.value ?? '');
  const error = dirty && !checked.ok ? validationMessage(T, checked.error) : null;
  const show = (v: string | null) =>
    displayValue(T, def, v, { locale, defaultValue: setting.defaultValue, inheritPlan });

  const change = (next: string) => {
    setDraft(next);
    // "próximas execuções" do rascunho: calculadas no evento, não no render (relógio do navegador)
    if (def.type === 'cron') {
      const v = validateSetting(def, next);
      setPreview(v.ok ? nextCronRuns(v.value, 3, new Date()).map((d) => d.toISOString()) : []);
    }
  };

  const doSave = () => run(() => saveSetting(def.key, draft), T.feedback.saved);
  const doReset = () => run(() => resetSetting(def.key), T.feedback.reset);
  const onSave = () => (def.critical ? setConfirm('save') : doSave());
  const fallback = setting.envValue ?? setting.defaultValue;
  const runs = def.type === 'cron' ? (preview ?? setting.nextRuns) : [];

  return (
    <div
      data-setting={def.key}
      className="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 lg:flex-row lg:items-start lg:justify-between lg:gap-6"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{text.label}</span>
          <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[11px]">
            {def.key}
          </code>
        </div>
        {text.description ? (
          <p className="text-muted-foreground text-xs leading-relaxed">{text.description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <SourceBadge source={setting.source} />
          <Badge variant="outline">
            {fill(T.apply[def.apply], { service: def.services.map((s) => T.services[s]).join(', ') })}
          </Badge>
          <span className="text-muted-foreground">
            {setting.source === 'db' && setting.updatedBy && setting.updatedAt
              ? fill(T.sourceDetail.db, {
                  by: setting.updatedBy,
                  when: f.relative(setting.updatedAt, Date.parse(now)),
                })
              : setting.source === 'env'
                ? T.sourceDetail.env
                : T.sourceDetail.default}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
          <span>
            {setting.envValue !== null
              ? fill(T.sourceDetail.envBehind, { value: show(setting.envValue) })
              : setting.reportedAt
                ? T.sourceDetail.noEnv
                : T.sourceDetail.notReported}
          </span>
          <span>{fill(T.sourceDetail.defaultIs, { value: show(setting.defaultValue) })}</span>
        </div>
        {setting.overrideInvalid ? (
          <p className="text-destructive text-xs">
            {fill(T.sourceDetail.invalidOverride, { value: setting.override ?? '' })}
          </p>
        ) : null}
        {aside}
      </div>

      <div className="flex w-full flex-col gap-2 lg:w-96 lg:shrink-0">
        <Control
          def={def}
          value={draft}
          onChange={change}
          disabled={pending}
          inheritPlan={inheritPlan}
          defaultValue={setting.defaultValue}
        />
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        {def.type === 'cron' ? (
          <div className="text-muted-foreground text-[11px]">
            <span className="font-medium">{T.cron.next}: </span>
            {runs.length ? runs.map((r) => f.dayTime(r)).join(' · ') : T.cron.none}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          {setting.source === 'db' || setting.overrideInvalid ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirm('reset')}>
              <RotateCcw />
              {T.actions.reset}
            </Button>
          ) : null}
          {dirty ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => change(initialDraft(setting))}
              >
                {T.actions.cancel}
              </Button>
              <Button size="sm" disabled={pending || !checked.ok} onClick={onSave}>
                {pending ? <Spinner /> : <Save />}
                {T.actions.save}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {fill(confirm === 'reset' ? T.actions.resetTitle : T.actions.confirmTitle, {
                name: text.label,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'reset'
                ? fill(T.actions.resetBody, { value: show(fallback) })
                : fill(T.actions.confirmBody, {
                    from: show(setting.value),
                    to: show(checked.ok ? checked.value : draft),
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.actions.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action === 'reset') doReset();
                else doSave();
              }}
            >
              {T.actions.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Control({
  def,
  value,
  onChange,
  disabled,
  inheritPlan,
  defaultValue,
}: {
  def: SettingDef;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  inheritPlan?: string | null | undefined;
  defaultValue: string | null;
}) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const options = def.options ?? [];

  if (def.type === 'enum' && !def.allowEmpty && options.length <= 4 && def.key !== 'APISPORTS_PLAN')
    return (
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        value={[value]}
        onValueChange={(next) => next[0] && onChange(next[0])}
        disabled={disabled}
        className="w-full"
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={o}
            value={o}
            className="data-[pressed]:bg-primary data-[pressed]:text-primary-foreground flex-1"
          >
            {optionLabel(T, def, o)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );

  if (def.type === 'enum') {
    const EMPTY = '__vazio__';
    const items = [
      ...(def.allowEmpty
        ? [{ value: EMPTY, label: displayValue(T, def, null, { locale, inheritPlan: inheritPlan ?? null }) }]
        : []),
      ...options.map((o) => ({ value: o, label: optionLabel(T, def, o) })),
    ];
    return (
      <Select
        items={items}
        value={value === '' ? EMPTY : value}
        onValueChange={(next) => onChange(next === EMPTY || next === null ? '' : String(next))}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
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
    );
  }

  if (def.type === 'markets') {
    const selected = value
      ? value
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map((v) => v.toUpperCase())
      : [];
    return (
      <div className="flex flex-col gap-1.5">
        <ToggleGroup
          variant="outline"
          size="sm"
          multiple
          value={selected}
          onValueChange={(next) => onChange(options.filter((o) => next.includes(o)).join(','))}
          disabled={disabled}
          className="flex-wrap"
        >
          {options.map((o) => (
            <ToggleGroupItem
              key={o}
              value={o}
              className="data-[pressed]:bg-primary data-[pressed]:text-primary-foreground font-mono text-xs"
            >
              {o}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {!selected.length ? (
          <span className="text-muted-foreground text-[11px]">{T.values.tenantsMarkets}</span>
        ) : null}
      </div>
    );
  }

  const unit = settingText(T, def).unit;
  const unlimited = value.trim().toLowerCase() === 'unlimited';
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Input
          value={unlimited ? '' : value}
          placeholder={
            unlimited ? T.values.unlimited : def.type === 'cron' ? T.cron.placeholder : (defaultValue ?? '')
          }
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          inputMode={def.type === 'int' || def.type === 'number' ? 'decimal' : undefined}
          spellCheck={false}
          aria-label={settingText(T, def).label}
          className={cn((def.type === 'cron' || def.type === 'text') && 'font-mono text-xs', unit && 'pr-16')}
        />
        {unit ? (
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
            {unit}
          </span>
        ) : null}
      </div>
      {def.unlimited ? (
        <Button
          variant={unlimited ? 'secondary' : 'outline'}
          size="sm"
          disabled={disabled}
          onClick={() => onChange(unlimited ? (defaultValue ?? '') : 'unlimited')}
        >
          {T.actions.unlimited}
        </Button>
      ) : null}
      {def.type === 'cron' ? (
        <Button
          variant={value === 'off' ? 'secondary' : 'outline'}
          size="sm"
          disabled={disabled}
          onClick={() => onChange(value === 'off' ? (defaultValue ?? '') : 'off')}
        >
          {value === 'off' ? T.actions.turnOn : T.actions.turnOff}
        </Button>
      ) : null}
    </div>
  );
}
