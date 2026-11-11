'use client';

import {
  MIRROR_BUDGET_KEY,
  MIRROR_GROUP_ORDER_FOOTBALL_KEY,
  MIRROR_GROUP_ORDER_SPORTS_KEY,
  MIRROR_PERIOD_MAX_DAYS,
  MIRROR_PERIOD_MIN_DAYS,
  estimateMirrorCalls,
  mirrorBudgetCalls,
  mirrorItems,
  mirrorPeriodsKey,
  type MirrorItemDef,
} from '@galaxie/runtime-config';
import { RotateCcw, Save } from 'lucide-react';
import { useMemo, useState } from 'react';

import { resetSetting, saveSetting } from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { isChanged, sportsByLabel } from '@/components/settings/blocks/logic';
import { SportRowsTable } from '@/components/settings/blocks/sport-rows-table';
import { useHash } from '@/components/settings/blocks/use-hash';
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
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { MirrorApiView, OpsSetting, OpsSnapshot } from '@/lib/ops/types';
import { cn } from '@/lib/utils';

import { draftState, initialDraft, type MirrorDraft } from './mirror-draft';
import { SettingRow, SourceBadge, useOpsAction } from './setting-row';

interface Ctx {
  snapshot: OpsSnapshot;
  timeZone: string;
}

const settingOf = (snapshot: OpsSnapshot, key: string) => snapshot.settings.find((s) => s.key === key);

/**
 * Espelho da api-sports: orçamento, ordem dos grupos, uma linha por esporte (padrão settings-2, #1075) com a
 * estimativa de chamadas dos períodos gravados e, abaixo, a tabela de períodos do esporte escolhido. Cada esporte
 * continua uma chave só (MIRROR_PERIODS_<API>), gravada como antes.
 */
export function MirrorTab({ snapshot, timeZone }: Ctx) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const M = T.mirror;
  const MB = T.blocks.mirror;
  const hash = useHash();
  // o "ver em…" chega com a chave no hash: abre o esporte dela
  const fromHash = snapshot.mirror.apis.find((a) => mirrorPeriodsKey(a.api) === hash)?.api;
  const [picked, setPicked] = useState<string | null>(null);
  const api = picked ?? fromHash ?? 'football';
  const { production, reservePercent } = snapshot.mirror;
  const budgetPercent = Number(settingOf(snapshot, MIRROR_BUDGET_KEY)?.value ?? 20);
  const view = snapshot.mirror.apis.find((a) => a.api === api)!;
  const periodsSetting = settingOf(snapshot, mirrorPeriodsKey(api))!;
  const n = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);
  const apis = snapshot.mirror.apis.map((a) => a.api);
  const sportRows = sportsByLabel(apis, T.apis).flatMap(({ api: rowApi, label }) => {
    const rowView = snapshot.mirror.apis.find((a) => a.api === rowApi)!;
    const s = settingOf(snapshot, mirrorPeriodsKey(rowApi));
    if (!s) return [];
    const periods = draftState(rowApi, initialDraft(rowApi, s.value)).periods;
    const total = estimateMirrorCalls(rowApi, (id) => periods.get(id) ?? [], rowView.inventory).total;
    const selected = rowApi === api;
    return [
      {
        api: rowApi,
        id: s.key,
        label,
        changed: isChanged(s),
        description: rowView.inventory ? fill(MB.estimate, { calls: n(total) }) : MB.noInventory,
        controls: (
          <Button
            variant={selected ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={selected}
            onClick={() => setPicked(rowApi)}
          >
            {selected ? MB.editing : MB.edit}
          </Button>
        ),
      },
    ];
  });

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{M.settingsTitle}</FrameTitle>
            <FrameDescription>
              {M.settingsDescription}{' '}
              {production
                ? fill(M.quotaProduction, { reserve: reservePercent })
                : fill(M.quotaDev, { reserve: reservePercent, free: 100 - reservePercent })}
            </FrameDescription>
          </FrameHeader>
          {[MIRROR_BUDGET_KEY, MIRROR_GROUP_ORDER_FOOTBALL_KEY, MIRROR_GROUP_ORDER_SPORTS_KEY].map((key) => {
            const s = settingOf(snapshot, key);
            return s ? (
              <SettingRow
                key={`${s.key}:${s.source}:${s.value}`}
                setting={s}
                timeZone={timeZone}
                now={snapshot.generatedAt}
              />
            ) : null;
          })}
        </FramePanel>
      </Frame>
      <SportRowsTable title={MB.title} description={MB.description} rows={sportRows} />
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>
              {fill(MB.periodsOf, { sport: T.apis[api as keyof typeof T.apis] ?? api })}
            </FrameTitle>
            <FrameDescription>{M.periodsDescription}</FrameDescription>
          </FrameHeader>
          <PeriodsEditor
            key={`${api}:${periodsSetting.source}:${periodsSetting.value ?? ''}`}
            view={view}
            setting={periodsSetting}
            budgetPercent={budgetPercent}
            freePercent={100 - reservePercent}
            timeZone={timeZone}
            now={snapshot.generatedAt}
          />
        </FramePanel>
      </Frame>
    </div>
  );
}

function PeriodsEditor({
  view,
  setting,
  budgetPercent,
  freePercent,
  timeZone,
  now,
}: {
  view: MirrorApiView;
  setting: OpsSetting;
  budgetPercent: number;
  freePercent: number;
  timeZone: string;
  now: string;
}) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const M = T.mirror;
  const f = useFormatters(timeZone);
  const { pending, run } = useOpsAction();
  const { api } = view;
  const apiName = T.apis[api as keyof typeof T.apis] ?? api;
  const initial = useMemo(() => initialDraft(api, setting.value), [api, setting.value]);
  const [draft, setDraft] = useState<MirrorDraft>(initial);
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);
  const state = draftState(api, draft);
  const saved = draftState(api, initial).text;
  const dirty = state.text !== saved || state.invalid.size > 0;
  const estimate = estimateMirrorCalls(api, (id) => state.periods.get(id) ?? [], view.inventory);
  const perId = new Map(estimate.items.map((i) => [i.id, i]));
  const free = view.plan === 'free';
  const budget = view.dailyLimit !== null ? mirrorBudgetCalls(view.dailyLimit, budgetPercent, free) : null;
  const n = (v: number, digits = 0) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v);
  const calls = n(estimate.total, estimate.total < 10 ? 1 : 0);

  const setCell = (id: string, col: number, patch: Partial<{ on: boolean; days: string }>) =>
    setDraft((d) => ({ ...d, [id]: d[id]!.map((c, i) => (i === col ? { ...c, ...patch } : c)) }));

  const doSave = () => run(() => saveSetting(setting.key, state.text), T.feedback.saved);
  const doReset = () => run(() => resetSetting(setting.key), T.feedback.reset);

  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="flex flex-col gap-1.5 px-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <SourceBadge source={setting.source} />
          <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[11px]">
            {setting.key}
          </code>
          <span className="font-medium tabular-nums">{fill(M.estimate, { calls })}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {budget === null
              ? M.noPlan
              : free
                ? fill(M.budgetFree, { budget: n(budget) })
                : fill(M.budget, { budget: n(budget), percent: budgetPercent, limit: n(view.dailyLimit!) })}
          </span>
        </div>
        {budget ? <Progress value={Math.min(100, (estimate.total / budget) * 100)} /> : null}
        {budget !== null && estimate.total > budget ? (
          <p className="text-warning text-xs">{M.overBudget}</p>
        ) : null}
        {!free && budgetPercent > freePercent ? (
          <p className="text-warning text-xs">{fill(M.overFree, { free: freePercent })}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {view.inventory
            ? fill(M.inventory, { when: f.relative(view.inventory.at, Date.parse(now)) })
            : view.inventoryOtherPlan
              ? fill(M.inventoryOtherPlan, { from: view.inventoryOtherPlan, to: view.plan ?? '' })
              : M.noInventory}
        </p>
        {setting.overrideInvalid ? (
          <p className="text-destructive text-xs">
            {fill(T.sourceDetail.invalidOverride, { value: setting.override ?? '' })}
          </p>
        ) : null}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">{M.columns.endpoint}</TableHead>
            <TableHead>{M.columns.group}</TableHead>
            <TableHead>{M.columns.periods}</TableHead>
            <TableHead className="text-right">{M.columns.requests}</TableHead>
            <TableHead className="pr-4 text-right">{M.columns.perDay}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mirrorItems(api).map((def) => {
            const est = perId.get(def.id);
            const changed = def.defaults.some((d, i) => state.periods.get(def.id)?.[i] !== d);
            return (
              <TableRow key={def.id}>
                <TableCell className="pl-4 align-top">
                  <code className="font-mono text-xs">{def.id}</code>
                  {changed ? (
                    <Badge variant="primary-light" className="ml-1.5">
                      {M.changed}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground align-top text-xs whitespace-normal">
                  <GroupCell def={def} />
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-wrap gap-3">
                    {draft[def.id]!.map((cell, col) => {
                      const bad = state.invalid.has(`${def.id}#${col}`);
                      return (
                        <label key={col} className="flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground w-12">{tierLabel(M, def, col)}</span>
                          <Switch
                            size="sm"
                            checked={cell.on}
                            disabled={pending}
                            onCheckedChange={(on) => setCell(def.id, col, { on })}
                            aria-label={`${def.id} ${tierLabel(M, def, col)}: ${M.on}`}
                          />
                          <Input
                            inputMode="numeric"
                            className={cn('h-7 w-16 text-right tabular-nums', bad && 'border-destructive')}
                            value={cell.days}
                            disabled={pending || !cell.on}
                            aria-invalid={bad || undefined}
                            title={
                              bad
                                ? fill(M.invalid, {
                                    min: MIRROR_PERIOD_MIN_DAYS,
                                    max: MIRROR_PERIOD_MAX_DAYS,
                                  })
                                : undefined
                            }
                            onChange={(e) => setCell(def.id, col, { days: e.target.value })}
                          />
                        </label>
                      );
                    })}
                  </div>
                </TableCell>
                <TableCell className="text-right align-top text-xs tabular-nums">
                  {view.inventory ? n(est?.requests ?? 0) : '—'}
                </TableCell>
                <TableCell className="pr-4 text-right align-top text-xs tabular-nums">
                  {view.inventory ? n(est?.callsPerDay ?? 0, 1) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {state.invalid.size ? (
        <p className="text-destructive px-4 text-xs">
          {fill(M.invalid, { min: MIRROR_PERIOD_MIN_DAYS, max: MIRROR_PERIOD_MAX_DAYS })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2 px-4">
        {setting.source === 'db' || setting.overrideInvalid ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirm('reset')}>
            <RotateCcw />
            {M.reset}
          </Button>
        ) : null}
        {dirty ? (
          <>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setDraft(initial)}>
              {M.discard}
            </Button>
            <Button size="sm" disabled={pending || state.invalid.size > 0} onClick={() => setConfirm('save')}>
              {pending ? <Spinner /> : <Save />}
              {M.save}
            </Button>
          </>
        ) : null}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {fill(confirm === 'reset' ? M.resetTitle : M.saveTitle, { api: apiName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'reset'
                ? M.resetBody
                : fill(M.saveBody, { calls, budget: budget === null ? '—' : n(budget) })}
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

type MirrorTexts = ReturnType<typeof useI18n>['t']['ops']['mirror'];

/** "Tier 1", "Tier 2", "Tier 3+" (o último vale para os tiers acima); sem tier, "Todos". */
function tierLabel(M: MirrorTexts, def: MirrorItemDef, col: number): string {
  if (!def.tiers.length) return M.allTiers;
  const tier = def.tiers[col]!;
  return fill(col === def.tiers.length - 1 ? M.tierLast : M.tier, { tier });
}

function GroupCell({ def }: { def: MirrorItemDef }) {
  const { t } = useI18n();
  const M = t.ops.mirror;
  const name = (g: string) => M.groupNames[g] ?? g;
  const extra = (def.tierGroups ?? []).map((g, col) => ({ g, col })).filter(({ g }) => g !== def.group);
  return (
    <div className="flex flex-col">
      <span>{name(def.group)}</span>
      {extra.map(({ g, col }) => (
        <span key={col} className="text-[11px]">
          {tierLabel(M, def, col)}: {name(g)}
        </span>
      ))}
    </div>
  );
}
