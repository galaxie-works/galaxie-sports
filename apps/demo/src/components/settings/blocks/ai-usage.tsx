'use client';

import { settingDef } from '@galaxie/runtime-config';
import type { ReactNode } from 'react';

import { displayValue } from '@/components/ops/format';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { OpsSetting } from '@/lib/ops/types';
import { cn } from '@/lib/utils';

import { AI_MODEL_AGENTS, capPercent, rulerMarks, spendParts } from './logic';
import { SettingRow } from './setting-row';

const first = (v: number | readonly number[]) => (Array.isArray(v) ? (v[0] ?? 0) : (v as number));

/**
 * Régua do teto (padrão `ai-usage-1`, #1078): slider com marcas de referência embaixo (composição dos exemplos
 * gratuitos `c-slider-10`, marcas, e `c-slider-9`, rótulos), o valor em destaque e a chave técnica à direita.
 */
export function BudgetRuler({
  id,
  label,
  keyName,
  value,
  min,
  max,
  step,
  marks = rulerMarks(min, max),
  format,
  onChange,
  disabled,
  extra,
  hint,
  display,
}: {
  id: string;
  label: string;
  keyName?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  marks?: readonly number[];
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** À direita do valor (ex.: o switch "sem limite"). */
  extra?: ReactNode;
  hint?: ReactNode;
  /** Texto no lugar do valor (ex.: "Sem limite"). */
  display?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {keyName ? <code className="text-muted-foreground font-mono text-xs">{keyName}</code> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="tabular-nums">
          {display ?? format(value)}
        </Badge>
        {extra}
      </div>
      <Slider
        id={id}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onValueChange={(v) => onChange(first(v))}
      />
      <span
        aria-hidden="true"
        className="text-muted-foreground flex w-full items-center justify-between gap-1 text-xs font-medium tabular-nums"
      >
        {marks.map((m, i) => (
          <span
            key={m}
            className={cn(
              'flex w-0 flex-col gap-1',
              i === 0 ? 'items-start' : i === marks.length - 1 ? 'items-end' : 'items-center',
            )}
          >
            <span className="bg-muted-foreground/70 h-1 w-px" />
            <span className="whitespace-nowrap">{format(m)}</span>
          </span>
        ))}
      </span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

/**
 * Painel "gasto do dia contra o teto" (#1078): o total de hoje, a parte do teto, a virada do dia e a parte dos
 * agentes que mais gastaram (o resto em "Outros"). Os números são os mesmos do contador do Status.
 */
export function SpendPanel({
  spent,
  cap,
  agents,
  day,
  money,
}: {
  spent: number;
  cap: number | null;
  agents: readonly { agent: string; costUsd: number }[];
  day: { start: string; timeZone: string };
  money: (v: number) => string;
}) {
  const { t } = useI18n();
  const B = t.ops.blocks.ai;
  const pct = capPercent(spent, cap);
  const { parts, others } = spendParts(agents);
  return (
    <Frame className="h-full">
      <FrameHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <FrameTitle>{B.spendTitle}</FrameTitle>
        <Badge variant="outline" className="tabular-nums">
          {cap === null ? B.noCap : fill(B.capBadge, { cap: money(cap) })}
        </Badge>
      </FrameHeader>
      <FramePanel className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">US$ {money(spent)}</span>
          <span className="text-muted-foreground text-xs">
            {pct === null
              ? fill(B.noCapTurn, day)
              : fill(B.ofCap, { percent: pct, start: day.start, timeZone: day.timeZone })}
          </span>
        </div>
        {pct !== null ? <Progress value={pct} aria-label={B.spendTitle} /> : null}
        {parts.length ? (
          <ul className="flex flex-col divide-y text-sm">
            {parts.map((p) => (
              <li key={p.agent} className="flex items-center justify-between gap-2 py-1.5">
                <span className="truncate font-mono text-xs">{p.agent}</span>
                <span className="tabular-nums">US$ {money(p.costUsd)}</span>
              </li>
            ))}
            {others > 0 ? (
              <li className="flex items-center justify-between gap-2 py-1.5">
                <span>{B.others}</span>
                <span className="tabular-nums">US$ {money(others)}</span>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{B.noSpend}</p>
        )}
      </FramePanel>
    </Frame>
  );
}

export interface BandCard {
  id: string;
  label: string;
  share: number;
  /** Gasto contra o teto da faixa, já no texto. */
  detail: ReactNode;
  capped?: boolean;
}

/**
 * Faixas de prioridade em cartões de rádio (`c-radio-group-17`, #1078): escolher a faixa abre o slider da parte dela
 * (`children`), no lugar de seis sliders empilhados. Nada muda no que é gravado (AI_BAND_SHARES).
 */
export function PriorityBandCards({
  bands,
  selected,
  onSelect,
  children,
}: {
  bands: readonly BandCard[];
  selected: string;
  onSelect: (id: string) => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const B = t.ops.blocks.ai;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{B.bandsTitle}</span>
        <span className="text-muted-foreground text-xs">{B.bandsDescription}</span>
      </div>
      <RadioGroup
        value={selected}
        onValueChange={(v) => onSelect(String(v))}
        aria-label={B.bandsTitle}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
      >
        {bands.map((b) => (
          <FieldLabel key={b.id} htmlFor={`ai-band-card-${b.id}`}>
            <Field orientation="horizontal">
              <RadioGroupItem value={b.id} id={`ai-band-card-${b.id}`} />
              <FieldContent>
                <FieldTitle className="flex w-full items-center justify-between gap-2">
                  <span>{b.label}</span>
                  <span className="text-sm font-semibold tabular-nums">{b.share}%</span>
                </FieldTitle>
                <FieldDescription className="flex flex-wrap items-center gap-1.5 tabular-nums">
                  {b.detail}
                  {b.capped ? <Badge variant="destructive-light">{t.ops.status.llmAgentCapped}</Badge> : null}
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
      {children}
    </div>
  );
}

/**
 * Modelo de cada agente (#1078): um cartão por agente com o provedor e os modelos dele em linhas de ajuste
 * aninhadas (o salvamento de sempre, uma chave por vez). Só entram os agentes com chave nesta lista.
 */
export function ModelAgentCards({
  settings,
  timeZone,
  now,
}: {
  settings: readonly OpsSetting[];
  timeZone: string;
  now: string;
}) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const B = T.blocks.ai;
  const find = (key: string) => settings.find((s) => s.key === key);
  const agents = AI_MODEL_AGENTS.map((a) => ({
    ...a,
    rows: a.keys.map(find).filter((s) => s !== undefined),
  })).filter((a) => a.rows.length > 0);
  if (!agents.length) return null;
  return (
    <div className="flex flex-col gap-3 px-4 py-4" id="modelos-dos-agentes">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{B.modelsTitle}</span>
        <span className="text-muted-foreground text-xs">{B.modelsDescription}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {agents.map((a) => {
          // o que está em uso: o modelo (ou o padrão do provedor) e o provedor
          const model = a.rows.find((s) => s.key.includes('MODEL'));
          const provider = a.rows.find((s) => s.key.endsWith('PROVIDER'));
          const used = [
            provider ? displayValue(T, settingDef(provider.key)!, provider.value, { locale }) : null,
            model ? (model.value ?? model.defaultValue) : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <Item key={a.id} variant="outline" className="items-start">
              <ItemContent>
                <ItemTitle>{B.agents[a.id]}</ItemTitle>
                {used ? <ItemDescription>{fill(B.inUse, { model: used })}</ItemDescription> : null}
              </ItemContent>
              <div className="flex w-full flex-col divide-y">
                {a.rows.map((s) => (
                  <SettingRow
                    key={`${s.key}:${s.source}:${s.value}`}
                    setting={s}
                    timeZone={timeZone}
                    now={now}
                    variant="nested"
                  />
                ))}
              </div>
            </Item>
          );
        })}
      </div>
    </div>
  );
}
