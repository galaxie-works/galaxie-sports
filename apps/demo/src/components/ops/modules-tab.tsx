'use client';

import {
  DAILY_CAPS,
  MODULE_APIS,
  dailyCapDefault,
  mirrorPeriodsKey,
  modulesKey,
  type DailyCapDef,
  type ModuleDef,
  type ModuleTier,
} from '@galaxie/runtime-config';
import { ChevronRight, ExternalLink, History, InfoIcon, RotateCcw, Save } from 'lucide-react';
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
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { settingHref } from '@/lib/ops/setting-page';
import { settingsHref } from '@/lib/ops/settings-items';
import type { MirrorApiView, OpsSetting, OpsSnapshot } from '@/lib/ops/types';
import { cn } from '@/lib/utils';

import {
  MODULE_ROWS,
  capSliderMax,
  capStep,
  capText,
  draftColumn,
  estimatedCallsPerDay,
  initialCapDraft,
  initialModuleDraft,
  isPaidPlan,
  measuredCallsPerDay,
  moduleDraftTexts,
  modulesNotCovering,
  modulesOfRow,
  partialInTier,
  rotationOverloaded,
  rowSummary,
  type CapDraft,
  type ModuleDraft,
} from './modules-draft';

const settingOf = (snapshot: OpsSnapshot, key: string) => snapshot.settings.find((s) => s.key === key);

/**
 * Módulos por esporte e tier (docs/03 §11.6): um frame por esporte, uma linha por tier que expande, um switch por
 * módulo com o custo de cota ao lado (medido no ledger dos últimos dias; estimado pelo inventário do espelho nos
 * módulos dele) e, abaixo, os tetos diários do sync diário (ilimitado sim/não; slider até a cota do plano). Salvar
 * grava as flags da API (MODULES_<API>, MIRROR_PERIODS_<API> e DAILY_*) pelas ações de sempre, cada uma no histórico
 * com quem mudou.
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
        const capSettings = DAILY_CAPS.flatMap((c) => {
          const s = settingOf(snapshot, c.key);
          return s ? [{ def: c, setting: s }] : [];
        });
        // os tetos diários são do sync diário do futebol
        const caps = api === 'football' ? capSettings : [];
        return (
          <SportModules
            key={`${api}:${modulesSetting.value ?? ''}:${mirrorSetting.value ?? ''}:${caps.map((c) => c.setting.value ?? '').join('|')}`}
            api={api}
            label={label}
            snapshot={snapshot}
            modulesSetting={modulesSetting}
            mirrorSetting={mirrorSetting}
            caps={caps}
          />
        );
      })}
    </div>
  );
}

interface CapSetting {
  def: DailyCapDef;
  setting: OpsSetting;
}

function SportModules({
  api,
  label,
  snapshot,
  modulesSetting,
  mirrorSetting,
  caps,
}: {
  api: string;
  label: string;
  snapshot: OpsSnapshot;
  modulesSetting: OpsSetting;
  mirrorSetting: OpsSetting;
  caps: CapSetting[];
}) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const M = T.modules;
  const router = useRouter();
  const { pending, apply } = useSaveSettings();
  const quota = snapshot.quota.find((q) => q.api === api);
  const paid = isPaidPlan(quota?.plan);
  const initial = useMemo(
    () => initialModuleDraft(api, modulesSetting.value, mirrorSetting.value),
    [api, modulesSetting.value, mirrorSetting.value],
  );
  const initialCaps = useMemo(
    () =>
      Object.fromEntries(
        caps.map((c) => [c.def.key, initialCapDraft(c.def.key, c.setting.value, paid)]),
      ) as Record<string, CapDraft>,
    [caps, paid],
  );
  const [draft, setDraft] = useState<ModuleDraft>(initial);
  const [capDraft, setCapDraft] = useState<Record<string, CapDraft>>(initialCaps);
  const [confirm, setConfirm] = useState(false);
  const saved = useMemo(
    () => moduleDraftTexts(api, initial, mirrorSetting.value),
    [api, initial, mirrorSetting.value],
  );
  const texts = moduleDraftTexts(api, draft, mirrorSetting.value);
  const changes: Record<string, string> = {};
  if (texts.modules !== saved.modules) changes[modulesSetting.key] = texts.modules;
  if (texts.mirror !== saved.mirror) changes[mirrorSetting.key] = texts.mirror;
  for (const c of caps) {
    const next = capText(c.def.key, capDraft[c.def.key]!, paid);
    const was = capText(c.def.key, initialCaps[c.def.key]!, paid);
    if (next !== was) changes[c.def.key] = next;
  }
  const dirty = Object.keys(changes).length > 0;
  const view: MirrorApiView | undefined = snapshot.mirror.apis.find((a) => a.api === api);
  const n = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);

  const measuredTotal = snapshot.modules.windowDays
    ? snapshot.modules.costs.filter((c) => c.api === api).reduce((s, c) => s + c.calls, 0) /
      snapshot.modules.windowDays
    : null;
  const changed =
    isChanged(modulesSetting) || isChanged(mirrorSetting) || caps.some((c) => isChanged(c.setting));
  const invalid =
    modulesSetting.overrideInvalid ||
    mirrorSetting.overrideInvalid ||
    caps.some((c) => c.setting.overrideInvalid);

  const toggle = (def: ModuleDef, col: number, on: boolean) =>
    setDraft((d) => ({ ...d, [def.id]: (d[def.id] ?? def.defaults).map((v, i) => (i === col ? on : v)) }));

  const doSave = () => apply({ save: changes }, fill(M.saved, { api: label }), () => setConfirm(false));
  const reset = () => {
    setDraft(initial);
    setCapDraft(initialCaps);
  };

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
        {caps.length ? (
          <CapsSection
            caps={caps}
            capDraft={capDraft}
            setCapDraft={setCapDraft}
            draft={draft}
            paid={paid}
            plan={quota?.plan ?? null}
            dailyLimit={quota?.dailyLimit ?? null}
            pending={pending}
          />
        ) : null}
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
            <Button variant="outline" size="sm" disabled={pending} onClick={reset}>
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
  const mirrorHref = `${settingsHref('mirror')}#${mirrorPeriodsKey(api)}`;
  const liveHref = settingHref('LIVE_MIN_PRIORITY');
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="group hover:bg-muted/50 flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm">
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
            const partial = on === was && partialInTier(api, def, periods, tier);
            return (
              <li
                key={def.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 border-t px-4 py-2.5 pl-11',
                  on !== was && 'bg-primary/5',
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    {name(def.id)}
                    {partial ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={<a href={mirrorHref} className="inline-flex" aria-label={M.openMirror} />}
                        >
                          <Badge variant="warning-light">{M.partial}</Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-64 text-xs">
                            {M.partialHint} {M.openMirror}.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground font-mono text-[11px] break-words">
                    {def.jobs.join(', ')}
                    {def.endpoints.length ? ` · ${def.endpoints.join(' ')}` : ''}
                    {period ? ` · ${fill(M.period, { days: period })}` : ''}
                    {fixed ? ` · ${M.fixed}` : ''}
                  </span>
                  {def.id === 'live' && liveHref ? (
                    <span className="text-muted-foreground text-[11px]">
                      {M.liveHint}{' '}
                      <a href={liveHref} className="inline-flex items-center gap-0.5 underline">
                        {M.openLive}
                        <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                    </span>
                  ) : null}
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

/**
 * Tetos diários do sync diário, abaixo dos módulos que cada um governa: "Ilimitado" sim ou não; com não, o slider
 * até a cota diária do plano, com o valor e o padrão do plano ao lado, e o tooltip explicando o que o teto segura e
 * em que tiers.
 */
function CapsSection({
  caps,
  capDraft,
  setCapDraft,
  draft,
  paid,
  plan,
  dailyLimit,
  pending,
}: {
  caps: CapSetting[];
  capDraft: Record<string, CapDraft>;
  setCapDraft: (next: (prev: Record<string, CapDraft>) => Record<string, CapDraft>) => void;
  draft: ModuleDraft;
  paid: boolean;
  plan: string | null;
  dailyLimit: number | null;
  pending: boolean;
}) {
  const { t, locale } = useI18n();
  const M = t.ops.modules;
  const C = M.caps;
  const n = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
  const name = (id: string) => M.names[id] ?? id;
  const max = capSliderMax(dailyLimit);
  const step = capStep(max);
  const set = (key: string, patch: Partial<CapDraft>) =>
    setCapDraft((prev) => ({ ...prev, [key]: { ...prev[key]!, ...patch } }));
  return (
    <div className="border-t">
      <div className="flex flex-col gap-0.5 px-4 pt-3 pb-1">
        <span className="text-sm font-medium">{C.title}</span>
        <span className="text-muted-foreground text-xs">
          {C.description} {fill(C.max, { max: n(max) })}
        </span>
      </div>
      <ul className="flex flex-col">
        {caps.map(({ def, setting }) => {
          const d = capDraft[def.key]!;
          const fallback = dailyCapDefault(def.key, paid);
          const value = Math.min(Math.max(1, d.value), max);
          const valueText = fill(def.unit === 'pages' ? C.valuePages : C.valueCalls, { value: n(value) });
          const warn =
            def.key === 'DAILY_ROTATION_CALLS' &&
            rotationOverloaded(draft, d.unlimited ? Number.POSITIVE_INFINITY : value, paid);
          return (
            <li
              key={def.key}
              id={def.key}
              className={cn(
                'flex scroll-mt-24 flex-col gap-2 border-t px-4 py-3 pl-11',
                isChanged(setting) && 'bg-primary/5',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{t.ops.settings[def.key]?.label ?? def.key}</span>
                <Tooltip>
                  <TooltipTrigger
                    render={<Button variant="ghost" size="icon-sm" aria-label={`${def.key}: ${C.title}`} />}
                  >
                    <InfoIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-80 text-xs">{C.explain[def.key] ?? ''}</p>
                  </TooltipContent>
                </Tooltip>
                <span className="text-muted-foreground font-mono text-[11px]">{def.key}</span>
                <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                  {d.unlimited ? C.noCap : valueText}
                </span>
                <label className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">{C.unlimited}</span>
                  <Switch
                    size="sm"
                    checked={d.unlimited}
                    disabled={pending}
                    onCheckedChange={(unlimited) => set(def.key, { unlimited })}
                    aria-label={`${def.key}: ${C.unlimited}`}
                  />
                </label>
              </div>
              {!d.unlimited ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Slider
                    className="min-w-48 flex-1"
                    value={value}
                    min={1}
                    max={max}
                    step={step}
                    disabled={pending}
                    aria-label={`${def.key}: ${valueText}`}
                    onValueChange={(v) => set(def.key, { value: Array.isArray(v) ? (v[0] ?? value) : v })}
                  />
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {fill(C.planDefault, { plan: plan ?? '—', value: n(fallback) })}
                  </span>
                </div>
              ) : null}
              <span className="text-muted-foreground text-[11px]">
                {fill(C.governs, { modules: def.modules.map(name).join(', ') })}
              </span>
              {warn ? <span className="text-warning text-xs">{C.rotationWarning}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
