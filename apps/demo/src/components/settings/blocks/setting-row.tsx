'use client';

import { nextCronRuns, settingDef, validateSetting } from '@galaxie/runtime-config';
import { History, MoreVertical, RotateCcw, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { resetSetting, saveSetting } from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { displayValue, settingText } from '@/components/ops/format';
import { useOpsAction } from '@/components/ops/use-ops-action';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSetting } from '@/lib/ops/types';
import { validationMessage } from '@/lib/ops/validation-message';
import { cn } from '@/lib/utils';

import { canReset, controlKind, historyHref, isChanged, isRequired } from './logic';
import { SettingControl } from './setting-control';

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
  /** `nested`: dentro de um cartão (integração, agente), sempre empilhada e sem borda de lista. */
  variant?: 'default' | 'nested';
  /** Controle travado, com este aviso embaixo (ex.: ligar as sugestões sem o GitHub conectado). */
  lockedHint?: string;
}

/** Texto do controle a partir do valor efetivo (vazio/nulo vira campo vazio). */
const initialDraft = (s: OpsSetting) => s.value ?? '';

/**
 * Linha de ajuste no desenho do bloco `settings-3` (#1074), com componentes gratuitos: rótulo, selos e descrição à
 * esquerda, a chave técnica em mono; o controle do tipo do registro à direita, com "Salvar" quando muda e o menu ⋮
 * ("Voltar ao padrão do .env", "Ver no histórico"). O `id` da linha é a chave, âncora da busca de ajustes (#1071).
 * Em telas estreitas o controle desce para baixo do rótulo. O salvamento é o de sempre: uma chave por vez, com
 * confirmação nas chaves críticas.
 */
export function SettingRow({
  setting,
  timeZone,
  now,
  inheritPlan,
  aside,
  actions,
  variant = 'default',
  lockedHint,
}: SettingRowProps) {
  const def = settingDef(setting.key)!;
  const { t, locale } = useI18n();
  const f = useFormatters(timeZone);
  const router = useRouter();
  const T = t.ops;
  const B = T.blocks;
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
  const nested = variant === 'nested';
  // o switch fica no tamanho dele, encostado à direita; os outros controles ocupam a largura
  const isSwitch = controlKind(def, text.unit) === 'switch';

  // de onde vem o valor, o que há no .env e o padrão, numa linha só de meta
  const origin =
    setting.source === 'db' && setting.updatedBy && setting.updatedAt
      ? fill(T.sourceDetail.db, {
          by: setting.updatedBy,
          when: f.relative(setting.updatedAt, Date.parse(now)),
        })
      : setting.source === 'env'
        ? T.sourceDetail.env
        : T.sourceDetail.default;
  const envText =
    setting.envValue !== null
      ? fill(T.sourceDetail.envBehind, { value: show(setting.envValue) })
      : setting.reportedAt
        ? T.sourceDetail.noEnv
        : T.sourceDetail.notReported;
  const applyText = fill(T.apply[def.apply], { service: def.services.map((s) => T.services[s]).join(', ') });

  return (
    <div
      id={def.key}
      data-setting={def.key}
      data-changed={isChanged(setting) || undefined}
      className={cn(
        'flex scroll-mt-24 flex-col gap-3',
        nested
          ? 'w-full py-1'
          : 'border-b px-4 py-4 last:border-b-0 md:flex-row md:items-start md:justify-between md:gap-6',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{text.label}</span>
          {isChanged(setting) ? <Badge variant="primary-light">{B.changed}</Badge> : null}
          {setting.overrideInvalid ? <Badge variant="destructive-light">{B.invalid}</Badge> : null}
          {isRequired(def) && !setting.value ? <Badge variant="warning-light">{B.required}</Badge> : null}
        </div>
        {text.description ? (
          <p className="text-muted-foreground text-sm leading-relaxed">{text.description}</p>
        ) : null}
        <code className="text-muted-foreground font-mono text-xs">{def.key}</code>
        <p className="text-muted-foreground text-xs">
          {[
            origin,
            envText,
            fill(T.sourceDetail.defaultIs, { value: show(setting.defaultValue) }),
            applyText,
          ].join(' · ')}
        </p>
        {setting.overrideInvalid ? (
          <p className="text-destructive text-xs">
            {fill(T.sourceDetail.invalidOverride, { value: setting.override ?? '' })}
          </p>
        ) : null}
        {aside}
      </div>

      <div className={cn('flex w-full flex-col gap-2', !nested && 'md:w-80 md:shrink-0 lg:w-96')}>
        <div className="flex items-start gap-2">
          <div className={cn('flex min-w-0 flex-1', isSwitch && 'justify-end self-center')}>
            <SettingControl
              def={def}
              value={draft}
              onChange={change}
              disabled={pending || Boolean(lockedHint)}
              inheritPlan={inheritPlan}
              defaultValue={setting.defaultValue}
              {...(isSwitch ? {} : { className: 'min-w-0 flex-1' })}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={fill(B.rowMenu, { name: text.label })} />
              }
            >
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem disabled={pending || !canReset(setting)} onClick={() => setConfirm('reset')}>
                <RotateCcw />
                {B.resetToEnv}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(historyHref(def.key))}>
                <History />
                {B.viewHistory}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {lockedHint ? <p className="text-muted-foreground text-xs">{lockedHint}</p> : null}
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        {def.type === 'cron' ? (
          <div className="text-muted-foreground text-xs">
            <span className="font-medium">{T.cron.next}: </span>
            {runs.length ? runs.map((r) => f.dayTime(r)).join(' · ') : T.cron.none}
          </div>
        ) : null}
        {actions || dirty ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {actions}
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
        ) : null}
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
