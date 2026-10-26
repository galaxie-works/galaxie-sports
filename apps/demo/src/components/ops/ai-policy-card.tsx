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
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
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
 * Política de IA (#357): as faixas do teto diário por prioridade (somam 100%, a reserva da P0 dentro), o
 * teto global em US$ e o corte P0/P1, com o gasto do dia de cada faixa ao lado. Grava como runtime
 * settings (AI_BAND_SHARES, AI_DAILY_USD_BUDGET, AI_P0_MIN_AUDIENCE) pelas mesmas regras do serviço.
 */
export function AiPolicyCard({ llm }: { llm: LlmSpend }) {
  const { t, locale } = useI18n();
  const T = t.ops.aiPolicy;
  const [shares, setShares] = useState<Record<AiBand, number>>({ ...llm.bandShares });
  const [usd, setUsd] = useState<number | null>(llm.usdBudget);
  const [cut, setCut] = useState(llm.p0MinAudience);
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
    <Frame>
      <FramePanel className="flex flex-col gap-5 p-4">
        <FrameHeader className="p-0">
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{T.description}</FrameDescription>
        </FrameHeader>
        <p className="text-muted-foreground text-xs">
          {fill(T.day, { day: llm.budgetDay, start: llm.day.start, timeZone: llm.day.timeZone })}
        </p>

        <div className="flex flex-col gap-4">
          {AI_BANDS.map((band) => {
            const text = T.bands[band];
            const limit = band === 'reserve' ? null : preview[band];
            const used = band === 'reserve' ? null : (spent.get(band) ?? 0);
            return (
              <div key={band} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <label htmlFor={`ai-band-${band}`} className="text-sm font-medium">
                    {text.label}
                  </label>
                  <span className="text-sm font-medium tabular-nums">{shares[band]}%</span>
                </div>
                <Slider
                  id={`ai-band-${band}`}
                  aria-label={text.label}
                  min={0}
                  max={100}
                  step={1}
                  value={shares[band]}
                  disabled={pending}
                  onValueChange={(v) => setShares((s) => ({ ...s, [band]: first(v) }))}
                />
                <div className="flex flex-wrap justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{text.description}</span>
                  <span className="tabular-nums">
                    {band === 'reserve'
                      ? T.reserveIn
                      : limit === null
                        ? fill(T.spentNoLimit, { used: money(used ?? 0) })
                        : fill(T.spent, { used: money(used ?? 0), limit: money(limit) })}
                    {limit !== null && used !== null && used >= limit ? (
                      <Badge variant="destructive-light" className="ml-1.5">
                        {t.ops.status.llmAgentCapped}
                      </Badge>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
          <span className={sum === 100 ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
            {sum === 100 ? fill(T.total, { sum }) : fill(T.totalInvalid, { sum })}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor="ai-daily-usd" className="text-sm font-medium">
              {T.dailyUsd.label}
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium tabular-nums">
                {usd === null ? T.unlimited : `US$ ${money(usd)}`}
              </span>
              <Switch
                aria-label={T.unlimited}
                checked={usd === null}
                disabled={pending}
                onCheckedChange={(on) => setUsd(on ? null : (llm.usdBudget ?? 10))}
              />
              <span className="text-muted-foreground text-xs">{T.unlimited}</span>
            </div>
          </div>
          <Slider
            id="ai-daily-usd"
            aria-label={T.dailyUsd.label}
            min={USD_MIN}
            max={usdMax}
            step={0.5}
            value={usd ?? USD_MIN}
            disabled={pending || usd === null}
            onValueChange={(v) => setUsd(first(v))}
          />
          <span className="text-muted-foreground text-xs">
            {usd === null ? T.unlimitedHint : T.dailyUsd.description}
          </span>
        </div>

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
  );
}
