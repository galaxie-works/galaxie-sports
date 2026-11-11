'use client';

import {
  AI_BANDS,
  bandLimitsUsd,
  formatBandShares,
  settingDef,
  validateSetting,
  type AiBand,
} from '@galaxie/runtime-config';
import { RotateCcw, Save, Undo2 } from 'lucide-react';
import { useState } from 'react';

import { resetAiPolicy, saveAiPolicy } from '@/app/[locale]/(app)/ajustes/operacao/actions';
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
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { BudgetRuler, PriorityBandCards, SpendPanel } from '@/components/settings/blocks/ai-usage';
import { rulerMarks } from '@/components/settings/blocks/logic';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { LlmSpend } from '@/lib/ops/types';
import { validationMessage } from '@/lib/ops/validation-message';

import { AI_POLICY_KEYS, needsConfirmation, type AiPolicyKey } from './ai-policy';
import { useOpsAction } from './setting-row';

/** Faixa do slider do teto global (o registro aceita até US$ 10.000; o slider cobre o uso normal). */
const USD_MIN = 0.5;
const USD_MAX = 50;

const first = (v: number | readonly number[]) => (Array.isArray(v) ? (v[0] ?? 0) : (v as number));

/**
 * Política de IA (#357) no padrão `ai-usage-1` (#1078): a régua do teto global em US$ com marcas, as faixas do
 * teto por prioridade em cartões de rádio (somam 100%, a reserva da P0 dentro; a faixa escolhida abre o slider
 * dela), o corte P0/P1 e, ao lado, o gasto do dia contra o teto. Grava como runtime settings (AI_BAND_SHARES,
 * AI_DAILY_USD_BUDGET, AI_P0_MIN_AUDIENCE) pelas mesmas regras do serviço.
 */
export function AiPolicyCard({ llm }: { llm: LlmSpend }) {
  const { t, locale } = useI18n();
  const T = t.ops.aiPolicy;
  const [shares, setShares] = useState<Record<AiBand, number>>({ ...llm.bandShares });
  const [usd, setUsd] = useState<number | null>(llm.usdBudget);
  const [cut, setCut] = useState(llm.p0MinAudience);
  const [band, setBand] = useState<AiBand>(AI_BANDS[0]!);
  const { pending, run } = useOpsAction();
  // chaves críticas (custo): gravar e voltar ao padrão pedem confirmação, como as flags do painel
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);

  const sum = AI_BANDS.reduce((s, b) => s + shares[b], 0);
  const sharesText = formatBandShares(shares);
  const changes: Partial<Record<AiPolicyKey, string>> = {
    ...(sharesText !== formatBandShares(llm.bandShares) ? { AI_BAND_SHARES: sharesText } : {}),
    ...(usd !== llm.usdBudget ? { AI_DAILY_USD_BUDGET: usd === null ? 'unlimited' : String(usd) } : {}),
    ...(cut !== llm.p0MinAudience ? { AI_P0_MIN_AUDIENCE: String(cut) } : {}),
  };
  // a mesma regra do servidor (registro): faixas que não somam 100 não saem do navegador
  const invalid = Object.entries(changes)
    .map(([key, value]) => {
      const checked = validateSetting(settingDef(key)!, value);
      return checked.ok ? null : validationMessage(t.ops, checked.error);
    })
    .find(Boolean);
  const dirty = Object.keys(changes).length > 0;

  const money = (v: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const preview = bandLimitsUsd(usd, shares);
  const spent = new Map(llm.bands.map((b) => [b.band, b.usedUsd]));
  const usdMax = Math.max(USD_MAX, Math.ceil(llm.usdBudget ?? 0));
  const doSave = () => run(() => saveAiPolicy(changes), T.saved);
  const doReset = () => run(() => resetAiPolicy(), T.resetDone);
  const current: Record<AiPolicyKey, string> = {
    AI_BAND_SHARES: formatBandShares(llm.bandShares),
    AI_DAILY_USD_BUDGET: llm.usdBudget === null ? 'unlimited' : String(llm.usdBudget),
    AI_P0_MIN_AUDIENCE: String(llm.p0MinAudience),
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Frame>
        <FramePanel className="flex flex-col gap-5 p-4">
          <FrameHeader className="p-0">
            <FrameTitle>{T.title}</FrameTitle>
            <FrameDescription>{T.description}</FrameDescription>
          </FrameHeader>
          <p className="text-muted-foreground text-xs">
            {fill(T.day, { day: llm.budgetDay, start: llm.day.start, timeZone: llm.day.timeZone })}
          </p>

          <BudgetRuler
            id="ai-daily-usd"
            label={T.dailyUsd.label}
            keyName="AI_DAILY_USD_BUDGET"
            min={USD_MIN}
            max={usdMax}
            step={0.5}
            marks={rulerMarks(0, usdMax)}
            value={usd ?? USD_MIN}
            format={(v) => `US$ ${money(v)}`}
            display={usd === null ? T.unlimited : undefined}
            disabled={pending || usd === null}
            onChange={setUsd}
            extra={
              <>
                <Switch
                  aria-label={T.unlimited}
                  checked={usd === null}
                  disabled={pending}
                  onCheckedChange={(on) => setUsd(on ? null : (llm.usdBudget ?? 10))}
                />
                <span className="text-muted-foreground text-xs">{T.unlimited}</span>
              </>
            }
            hint={usd === null ? T.unlimitedHint : T.dailyUsd.description}
          />

          <PriorityBandCards
            selected={band}
            onSelect={(id) => setBand(id as AiBand)}
            bands={AI_BANDS.map((b) => {
              const limit = b === 'reserve' ? null : preview[b];
              const used = b === 'reserve' ? null : (spent.get(b) ?? 0);
              return {
                id: b,
                label: T.bands[b].label,
                share: shares[b],
                detail:
                  b === 'reserve'
                    ? T.reserveIn
                    : limit === null
                      ? fill(T.spentNoLimit, { used: money(used ?? 0) })
                      : fill(T.spent, { used: money(used ?? 0), limit: money(limit) }),
                capped: limit !== null && used !== null && used >= limit,
              };
            })}
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label htmlFor={`ai-band-${band}`} className="text-sm font-medium">
                  {T.bands[band].label}
                </label>
                <span className="text-sm font-medium tabular-nums">{shares[band]}%</span>
              </div>
              <Slider
                id={`ai-band-${band}`}
                aria-label={T.bands[band].label}
                min={0}
                max={100}
                step={1}
                value={shares[band]}
                disabled={pending}
                onValueChange={(v) => setShares((s) => ({ ...s, [band]: first(v) }))}
              />
              <span className="text-muted-foreground text-xs">{T.bands[band].description}</span>
              <span className={sum === 100 ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
                {sum === 100 ? fill(T.total, { sum }) : fill(T.totalInvalid, { sum })}
              </span>
            </div>
          </PriorityBandCards>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor="ai-p0-cut" className="text-sm font-medium">
                {T.minAudience.label}
              </label>
              <span className="text-sm font-medium tabular-nums">{cut}</span>
            </div>
            <Slider
              id="ai-p0-cut"
              aria-label={T.minAudience.label}
              min={1}
              max={40}
              step={1}
              value={cut}
              disabled={pending}
              onValueChange={(v) => setCut(first(v))}
            />
            <span className="text-muted-foreground text-xs">{T.minAudience.description}</span>
          </div>

          {invalid ? <span className="text-destructive text-xs">{invalid}</span> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !dirty}
              onClick={() => {
                setShares({ ...llm.bandShares });
                setUsd(llm.usdBudget);
                setCut(llm.p0MinAudience);
              }}
            >
              <RotateCcw />
              {T.reset}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !llm.policyOverridden}
              onClick={() => (needsConfirmation(AI_POLICY_KEYS) ? setConfirm('reset') : doReset())}
            >
              <Undo2 />
              {T.resetDefault}
            </Button>
            <Button
              size="sm"
              disabled={pending || !dirty || !!invalid}
              onClick={() => (needsConfirmation(Object.keys(changes)) ? setConfirm('save') : doSave())}
            >
              {pending ? <Spinner /> : <Save />}
              {T.save}
            </Button>
          </div>
          <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {fill(confirm === 'reset' ? t.ops.actions.resetTitle : t.ops.actions.confirmTitle, {
                    name: T.title,
                  })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm === 'reset'
                    ? T.resetConfirmBody
                    : `${(Object.keys(changes) as AiPolicyKey[])
                        .map((key) => `${key}: ${current[key]} → ${changes[key]}`)
                        .join('; ')}. ${T.confirmCost}`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.ops.actions.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const action = confirm;
                    setConfirm(null);
                    if (action === 'reset') doReset();
                    else doSave();
                  }}
                >
                  {t.ops.actions.confirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </FramePanel>
      </Frame>
      <SpendPanel
        spent={llm.totals.costUsd}
        cap={llm.usdBudget}
        agents={llm.byAgent}
        day={llm.day}
        money={money}
      />
    </div>
  );
}
