'use client';

import {
  MODULE_APIS,
  mirrorPeriodsKey,
  modulesKey,
  type ModuleDef,
  type ModuleTier,
} from '@galaxie/runtime-config';
import { ChevronRight, History, RotateCcw, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { IconTile } from '@/components/reui/icon-tile';
import { historyHref, isChanged, sportsByLabel } from '@/components/settings/blocks/logic';
import { SportIcon } from '@/components/settings/blocks/sport-rows-table';
import { useSaveSettings } from '@/components/settings/blocks/use-save-settings';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { MirrorApiView, OpsSetting, OpsSnapshot } from '@/lib/ops/types';
import { cn } from '@/lib/utils';

import {
  MODULE_ROWS,
  draftColumn,
  estimatedCallsPerDay,
  initialModuleDraft,
  measuredCallsPerDay,
  moduleDraftTexts,
  modulesNotCovering,
  modulesOfRow,
  rowSummary,
  type ModuleDraft,
} from './modules-draft';

const settingOf = (snapshot: OpsSnapshot, key: string) => snapshot.settings.find((s) => s.key === key);

/**
 * Módulos por esporte e tier (docs/03 §11.6): um frame por esporte, uma linha por tier que expande, um switch por
 * módulo com o custo de cota ao lado (medido no ledger dos últimos dias; estimado pelo inventário do espelho nos
 * módulos dele). Salvar grava as duas flags da API (MODULES_<API> e MIRROR_PERIODS_<API>) pelas ações de sempre, cada
 * uma no histórico com quem mudou.
 */
export function ModulesTab({ snapshot }: { snapshot: OpsSnapshot }) {
  const { t } = useI18n();
  const T = t.ops;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        {snapshot.modules.windowDays
          ? fill(T.modules.intro, { days: snapshot.modules.windowDays })
          : T.modules.introNoLedger}
      </p>
      {sportsByLabel(MODULE_APIS, T.apis).map(({ api, label }) => {
        const modulesSetting = settingOf(snapshot, modulesKey(api));
        const mirrorSetting = settingOf(snapshot, mirrorPeriodsKey(api));
        if (!modulesSetting || !mirrorSetting) return null;
        return (
          <SportModules
            key={`${api}:${modulesSetting.value ?? ''}:${mirrorSetting.value ?? ''}`}
            api={api}
            label={label}
            snapshot={snapshot}
            modulesSetting={modulesSetting}
            mirrorSetting={mirrorSetting}
          />
        );
      })}
    </div>
  );
}

function SportModules({
  api,
  label,
  snapshot,
  modulesSetting,
  mirrorSetting,
}: {
  api: string;
  label: string;
  snapshot: OpsSnapshot;
  modulesSetting: OpsSetting;
  mirrorSetting: OpsSetting;
}) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const M = T.modules;
  const router = useRouter();
  const { pending, apply } = useSaveSettings();
  const initial = useMemo(
    () => initialModuleDraft(api, modulesSetting.value, mirrorSetting.value),
    [api, modulesSetting.value, mirrorSetting.value],
  );
  const [draft, setDraft] = useState<ModuleDraft>(initial);
  const [confirm, setConfirm] = useState(false);
  const saved = useMemo(
    () => moduleDraftTexts(api, initial, mirrorSetting.value),
    [api, initial, mirrorSetting.value],
  );
  const texts = moduleDraftTexts(api, draft, mirrorSetting.value);
  const changes: Record<string, string> = {};
  if (texts.modules !== saved.modules) changes[modulesSetting.key] = texts.modules;
  if (texts.mirror !== saved.mirror) changes[mirrorSetting.key] = texts.mirror;
  const dirty = Object.keys(changes).length > 0;
  const view: MirrorApiView | undefined = snapshot.mirror.apis.find((a) => a.api === api);
  const quota = snapshot.quota.find((q) => q.api === api);
  const n = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);

  const measuredTotal = snapshot.modules.windowDays
    ? snapshot.modules.costs.filter((c) => c.api === api).reduce((s, c) => s + c.calls, 0) /
      snapshot.modules.windowDays
    : null;
  const changed = isChanged(modulesSetting) || isChanged(mirrorSetting);
  const invalid = modulesSetting.overrideInvalid || mirrorSetting.overrideInvalid;

  const toggle = (def: ModuleDef, col: number, on: boolean) =>
    setDraft((d) => ({ ...d, [def.id]: (d[def.id] ?? def.defaults).map((v, i) => (i === col ? on : v)) }));

  const doSave = () => apply({ save: changes }, fill(M.saved, { api: label }), () => setConfirm(false));

  return (
    // a âncora da chave (#1071): "ver em…" e a busca abrem a página no frame do esporte
    <Frame id={modulesSetting.key} className="scroll-mt-24">
      <FrameHeader className="flex-row flex-wrap items-center gap-3">
        <IconTile size="sm" aria-hidden="true">
          <SportIcon api={api} />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <FrameTitle>{label}</FrameTitle>
            {changed ? <Badge variant="primary-light">{T.blocks.changed}</Badge> : null}
            {invalid ? <Badge variant="destructive-light">{T.blocks.invalid}</Badge> : null}
          </div>
          <FrameDescription>
            {quota?.plan
              ? fill(M.plan, {
                  plan: quota.plan,
                  limit: quota.dailyLimit === null ? '—' : n(quota.dailyLimit),
                })
              : M.noPlan}
          </FrameDescription>
        </div>
        <div className="flex flex-col items-end text-right tabular-nums">
          <span className="text-sm font-medium">
            {measuredTotal === null ? M.noLedger : fill(M.measuredTotal, { calls: n(measuredTotal) })}
          </span>
          <span className="text-muted-foreground text-xs">
            {measuredTotal === null ? '' : fill(M.measuredWindow, { days: snapshot.modules.windowDays })}
          </span>
        </div>
      </FrameHeader>
      <FramePanel className="p-0">
        {MODULE_ROWS.map((tier) => {
          const defs = modulesOfRow(api, tier);
          if (!defs.length) return null;
          const summary = rowSummary(api, draft, tier);
          const missing = tier === null ? [] : modulesNotCovering(api, tier);
          return (
            <TierRow
              key={tier ?? 'all'}
              api={api}
              tier={tier}
              defs={defs}
              missing={missing}
              summary={summary}
              draft={draft}
              initial={initial}
              pending={pending}
              onToggle={toggle}
              periods={texts.periods}
              view={view ?? null}
              snapshot={snapshot}
              defaultOpen={tier === 1}
            />
          );
        })}
      </FramePanel>
      <FrameFooter className="flex-row flex-wrap items-center justify-end gap-2">
        <span className="text-muted-foreground mr-auto text-xs">
          {dirty ? fill(M.pending, { keys: Object.keys(changes).join(', ') }) : M.noChanges}
        </span>
        <Button variant="ghost" size="sm" onClick={() => router.push(historyHref(modulesSetting.key))}>
          <History />
          {T.blocks.viewHistory}
        </Button>
        {dirty ? (
          <>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setDraft(initial)}>
              <RotateCcw />
              {M.discard}
            </Button>
            <Button size="sm" disabled={pending} onClick={() => setConfirm(true)}>
              {pending ? <Spinner /> : <Save />}
              {M.save}
            </Button>
          </>
        ) : null}
      </FrameFooter>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fill(M.saveTitle, { api: label })}</AlertDialogTitle>
            <AlertDialogDescription>
              {M.saveBody}
              <span className="mt-2 block font-mono text-xs whitespace-pre-wrap">
                {Object.entries(changes)
                  .map(([key, value]) => `${key}=${value || M.emptyValue}`)
                  .join('\n')}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.actions.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={doSave}>{T.actions.confirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Frame>
  );
}

function TierRow({
  api,
  tier,
  defs,
  missing,
  summary,
  draft,
  initial,
  pending,
  onToggle,
  periods,
  view,
  snapshot,
  defaultOpen,
}: {
  api: string;
  tier: ModuleTier | null;
  defs: ModuleDef[];
  missing: ModuleDef[];
  summary: { on: number; total: number };
  draft: ModuleDraft;
  initial: ModuleDraft;
  pending: boolean;
  onToggle: (def: ModuleDef, col: number, on: boolean) => void;
  periods: ReadonlyMap<string, readonly (number | null)[]>;
  view: MirrorApiView | null;
  snapshot: OpsSnapshot;
  defaultOpen: boolean;
}) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const M = T.modules;
  const n = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);
  const name = (id: string) => M.names[id] ?? id;
  const tierLabel = tier === null ? M.allTiers : fill(tier === 3 ? M.tierLast : M.tier, { tier });
  const rowEstimate = defs.reduce((s, d) => {
    const e = estimatedCallsPerDay(api, d, periods, view?.inventory ?? null, tier ?? undefined);
    return e === null ? s : s + e;
  }, 0);
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="group flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50">
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-90"
        />
        <span className="flex-1 font-medium">{tierLabel}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {fill(M.rowSummary, { on: summary.on, total: summary.total })}
          {view?.inventory && rowEstimate > 0 ? ` · ${fill(M.rowEstimate, { calls: n(rowEstimate) })}` : ''}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="bg-muted/20 flex flex-col">
          {defs.map((def) => {
            const col = draftColumn(def, tier);
            const states = draft[def.id] ?? def.defaults;
            const on = states[col] ?? false;
            const was = (initial[def.id] ?? def.defaults)[col] ?? false;
            const fixed = def.kind === 'fixed';
            const measured = measuredCallsPerDay(api, def, snapshot.modules);
            const estimate = estimatedCallsPerDay(
              api,
              def,
              periods,
              view?.inventory ?? null,
              tier ?? undefined,
            );
            const period =
              def.kind === 'mirror' && def.items[0]
                ? (periods.get(def.items[0])?.[Math.max(0, col)] ?? null)
                : null;
            return (
              <li
                key={def.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 border-t px-4 py-2.5 pl-11',
                  on !== was && 'bg-primary/5',
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm">{name(def.id)}</span>
                  <span className="text-muted-foreground font-mono text-[11px] break-words">
                    {def.jobs.join(', ')}
                    {def.endpoints.length ? ` · ${def.endpoints.join(' ')}` : ''}
                    {period ? ` · ${fill(M.period, { days: period })}` : ''}
                    {fixed ? ` · ${M.fixed}` : ''}
                  </span>
                </div>
                <div className="flex flex-col items-end text-right text-xs tabular-nums">
                  {def.ai ? (
                    <span className="text-muted-foreground">{M.aiCost}</span>
                  ) : (
                    <>
                      <span>{measured === null ? '—' : fill(M.measured, { calls: n(measured) })}</span>
                      <span className="text-muted-foreground text-[11px]">
                        {estimate === null
                          ? measured === null
                            ? M.noLedger
                            : M.measuredAllTiers
                          : fill(M.estimated, { calls: n(estimate) })}
                      </span>
                    </>
                  )}
                </div>
                <Switch
                  checked={on}
                  disabled={pending || fixed}
                  onCheckedChange={(next) => onToggle(def, col, next)}
                  aria-label={`${name(def.id)} · ${tierLabel}`}
                />
              </li>
            );
          })}
          {missing.length ? (
            <li className="text-muted-foreground border-t px-4 py-2 pl-11 text-xs">
              {fill(M.notCovered, { names: missing.map((d) => name(d.id)).join(', ') })}
            </li>
          ) : null}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
