'use client';

import {
  APISPORTS_APIS,
  POSTGAME_APIS,
  planKey,
  postgameIntervalKey,
  postgameModeKey,
  settingDef,
  validateSetting,
} from '@galaxie/runtime-config';
import { Power, PowerOff, Save, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { displayValue, optionLabel, settingText } from '@/components/ops/format';
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
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSetting } from '@/lib/ops/types';
import { validationMessage } from '@/lib/ops/validation-message';

import { bulkPostgameChanges, draftChanges, isChanged, postgameOnValue, sportsByLabel } from './logic';
import { SettingControl } from './setting-control';
import { SportRowsTable } from './sport-rows-table';
import { useSaveSettings } from './use-save-settings';

type Draft = Record<string, string>;

/** Rascunho de várias chaves: valor atual (rascunho ou efetivo), mudanças e o primeiro erro de validação. */
function useDraft(settings: readonly OpsSetting[]) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>({});
  const value = (key: string) => draft[key] ?? settings.find((s) => s.key === key)?.value ?? '';
  const set = (key: string, next: string) => setDraft((d) => ({ ...d, [key]: next }));
  const changes = draftChanges(settings, draft);
  const invalid = Object.entries(changes)
    .map(([key, v]) => {
      const checked = validateSetting(settingDef(key)!, v);
      return checked.ok
        ? null
        : `${settingText(t.ops, settingDef(key)!).label}: ${validationMessage(t.ops, checked.error)}`;
    })
    .find(Boolean);
  return { value, set, changes, invalid: invalid ?? null, clear: () => setDraft({}) };
}

/** Rodapé com o que falta salvar, "Desfazer" e "Salvar" (com confirmação nas chaves críticas, como a linha). */
function DraftFooter({
  changes,
  invalid,
  pending,
  onUndo,
  onSave,
  extra,
  describe,
}: {
  changes: Readonly<Draft>;
  invalid: string | null;
  pending: boolean;
  onUndo: () => void;
  onSave: () => void;
  extra?: ReactNode;
  describe: (key: string, value: string) => string;
}) {
  const { t } = useI18n();
  const B = t.ops.blocks;
  const [confirm, setConfirm] = useState(false);
  const keys = Object.keys(changes);
  const critical = keys.some((k) => settingDef(k)?.critical);
  return (
    <>
      {invalid ? <span className="text-destructive mr-auto text-xs">{invalid}</span> : null}
      {!invalid && keys.length ? (
        <span className="text-muted-foreground mr-auto text-xs">
          {fill(B.pendingCount, { count: keys.length })}
        </span>
      ) : null}
      {extra}
      <Button variant="outline" size="sm" disabled={pending || !keys.length} onClick={onUndo}>
        <Undo2 />
        {B.undo}
      </Button>
      <Button
        size="sm"
        disabled={pending || !keys.length || Boolean(invalid)}
        onClick={() => (critical ? setConfirm(true) : onSave())}
      >
        {pending ? <Spinner /> : <Save />}
        {B.save}
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fill(B.saveTitle, { count: keys.length })}</AlertDialogTitle>
            <AlertDialogDescription>
              {fill(B.saveBody, { changes: keys.map((k) => describe(k, changes[k]!)).join('; ') })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.ops.actions.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false);
                onSave();
              }}
            >
              {t.ops.actions.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** "Desligar todos" ou "Ligar todos", com confirmação: grava só as chaves de modo que mudam. */
function BulkButton({
  on,
  count,
  pending,
  onConfirm,
}: {
  on: boolean;
  count: number;
  pending: boolean;
  onConfirm: () => void;
}) {
  const B = useI18n().t.ops.blocks.sports;
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" disabled={pending || count === 0} onClick={() => setOpen(true)}>
        {on ? <Power /> : <PowerOff />}
        {on ? B.turnAllOn : B.turnAllOff}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{on ? B.allOnTitle : B.allOffTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {fill(on ? B.allOnBody : B.allOffBody, { count })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.ops.actions.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {on ? B.turnAllOn : B.turnAllOff}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Pós-jogo por esporte (#1075): uma linha por esporte com o modo, os minutos (`input-group` "min") e o liga/desliga;
 * o teto do dia vem antes (`before`). As chaves são as mesmas de sempre (POSTGAME_<API> e POSTGAME_<API>_MIN):
 * "Salvar" grava cada chave mudada; "Desligar todos / Ligar todos" grava as de modo, cada uma no histórico.
 */
export function PostgameTable({ settings, before }: { settings: readonly OpsSetting[]; before?: ReactNode }) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const B = T.blocks.sports;
  const d = useDraft(settings);
  const { pending, saveAll } = useSaveSettings();
  const has = (key: string) => settings.some((s) => s.key === key);
  const apis = POSTGAME_APIS.filter((api) => has(postgameModeKey(api)) || has(postgameIntervalKey(api)));
  const bulkOff = bulkPostgameChanges(settings, {}, false);
  const bulkOn = bulkPostgameChanges(settings, {}, true);
  const modeDef = settingDef(postgameModeKey(POSTGAME_APIS[0]!))!;
  const modes = (modeDef.options ?? []).filter((o) => o !== 'off');

  const rows = sportsByLabel(apis, T.apis).map(({ api, label }) => {
    const modeKey = postgameModeKey(api);
    const minKey = postgameIntervalKey(api);
    const mode = d.value(modeKey);
    const minutes = d.value(minKey);
    const on = mode !== 'off';
    const changed = settings.some((s) => (s.key === modeKey || s.key === minKey) && isChanged(s));
    return {
      api,
      id: has(modeKey) ? modeKey : minKey,
      alsoIds: has(modeKey) && has(minKey) ? [minKey] : [],
      label,
      changed,
      description: on ? fill(B.postgameOn, { mode: optionLabel(T, modeDef, mode), minutes }) : B.postgameOff,
      controls: (
        <>
          {on && has(modeKey) ? (
            <Select
              items={modes.map((m) => ({ value: m, label: optionLabel(T, modeDef, m) }))}
              value={mode}
              onValueChange={(next) => next && d.set(modeKey, String(next))}
              disabled={pending}
            >
              <SelectTrigger size="sm" className="w-36" aria-label={fill(B.mode, { sport: label })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modes.map((m) => (
                  <SelectItem key={m} value={m}>
                    {optionLabel(T, modeDef, m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {on && has(minKey) ? (
            <InputGroup className="w-24">
              <InputGroupInput
                value={minutes}
                onChange={(e) => d.set(minKey, e.target.value)}
                inputMode="numeric"
                disabled={pending}
                aria-label={fill(B.interval, { sport: label })}
                className="tabular-nums"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{settingText(T, settingDef(minKey)!).unit}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          ) : null}
          {has(modeKey) ? (
            <Switch
              checked={on}
              disabled={pending}
              aria-label={fill(B.toggle, { sport: label })}
              onCheckedChange={(next) => {
                const s = settings.find((x) => x.key === modeKey)!;
                // religar volta ao modo gravado; se o gravado é desligado, ao do .env ou ao fechamento
                d.set(modeKey, next ? (s.value && s.value !== 'off' ? s.value : postgameOnValue(s)) : 'off');
              }}
            />
          ) : null}
        </>
      ),
    };
  });

  const describe = (key: string, value: string) => {
    const def = settingDef(key)!;
    return `${settingText(T, def).label}: ${displayValue(T, def, value, { locale })}`;
  };

  return (
    <SportRowsTable
      title={B.postgameTitle}
      description={B.postgameDescription}
      rows={rows}
      before={before}
      footer={
        <DraftFooter
          changes={d.changes}
          invalid={d.invalid}
          pending={pending}
          onUndo={d.clear}
          onSave={() => saveAll(d.changes, T.feedback.saved, d.clear)}
          describe={describe}
          extra={
            <>
              {Object.keys(bulkOff).length ? (
                <BulkButton
                  on={false}
                  count={Object.keys(bulkOff).length}
                  pending={pending}
                  onConfirm={() => saveAll(bulkOff, T.feedback.saved, d.clear)}
                />
              ) : null}
              {Object.keys(bulkOn).length ? (
                <BulkButton
                  on
                  count={Object.keys(bulkOn).length}
                  pending={pending}
                  onConfirm={() => saveAll(bulkOn, T.feedback.saved, d.clear)}
                />
              ) : null}
            </>
          }
        />
      }
    />
  );
}

/**
 * Plano por esporte (#1075): uma linha por API com o `select` do plano; vazio herda o plano padrão (a descrição diz
 * qual). As chaves críticas pedem confirmação antes de gravar, como na linha de ajuste.
 */
export function PlanTable({
  settings,
  inheritPlan,
  title,
  description,
}: {
  settings: readonly OpsSetting[];
  inheritPlan: string | null;
  title?: string;
  description?: string;
}) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const B = T.blocks.sports;
  const d = useDraft(settings);
  const { pending, saveAll } = useSaveSettings();
  const apis = APISPORTS_APIS.filter((api) => settings.some((s) => s.key === planKey(api)));

  const rows = sportsByLabel(apis, T.apis).map(({ api, label }) => {
    const key = planKey(api);
    const def = settingDef(key)!;
    const s = settings.find((x) => x.key === key)!;
    const value = d.value(key);
    return {
      api,
      id: key,
      label,
      changed: isChanged(s),
      description: value
        ? displayValue(T, def, value, { locale })
        : `${B.inherits} · ${displayValue(T, def, null, { locale, inheritPlan })}`,
      controls: (
        <SettingControl
          def={def}
          value={value}
          onChange={(next) => d.set(key, next)}
          disabled={pending}
          inheritPlan={inheritPlan}
          defaultValue={s.defaultValue}
          label={fill(B.planOf, { sport: label })}
          className="w-full sm:w-56"
        />
      ),
    };
  });

  const describe = (key: string, value: string) => {
    const def = settingDef(key)!;
    const from = settings.find((s) => s.key === key)?.value ?? null;
    return `${settingText(T, def).label}: ${displayValue(T, def, from, { locale, inheritPlan })} → ${displayValue(T, def, value, { locale, inheritPlan })}`;
  };

  return (
    <SportRowsTable
      title={title ?? B.planTitle}
      description={description ?? B.planDescription}
      rows={rows}
      footer={
        <DraftFooter
          changes={d.changes}
          invalid={d.invalid}
          pending={pending}
          onUndo={d.clear}
          onSave={() => saveAll(d.changes, T.feedback.saved, d.clear)}
          describe={describe}
        />
      }
    />
  );
}
