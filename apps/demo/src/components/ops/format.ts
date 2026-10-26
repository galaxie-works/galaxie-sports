import { SEPARATE_TOKEN_POOLS, isCronOff, type SettingDef } from '@galaxie/runtime-config';

import type { ClientDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/config';
import { fill } from '@/lib/i18n/text';

type T = ClientDictionary['ops'];

/** Rótulo e descrição de uma flag (as de agenda e de plano por API usam modelos). */
export function settingText(t: T, def: SettingDef): { label: string; description: string; unit?: string } {
  if (def.job) {
    const job = t.jobs.names[def.job as keyof T['jobs']['names']];
    return { label: job?.label ?? def.job, description: job?.description ?? '' };
  }
  if (def.key.startsWith('APISPORTS_PLAN_')) {
    const api = def.key.slice('APISPORTS_PLAN_'.length).toLowerCase().replace(/_/g, '-');
    const name = t.apis[api as keyof T['apis']] ?? api;
    return { label: fill(t.planFor.label, { api: name }), description: t.planFor.description };
  }
  const text = t.settings[def.key];
  return {
    label: text?.label ?? def.key,
    description: text?.description ?? '',
    ...(text?.unit ? { unit: text.unit } : {}),
  };
}

/** Rótulo de um valor de enum (destaque e prioridade do ao vivo e planos têm nome próprio). */
export function optionLabel(t: T, def: SettingDef, option: string): string {
  if (
    def.key === 'LIVE_FEATURED' ||
    def.key === 'ASSETS_CUSTOM_LOGOS' ||
    def.key === 'WTW_CHANNEL_POST' ||
    def.key === 'AI_STATUS'
  )
    return t.values[option as 'off' | 'auto' | 'on'] ?? option;
  if (def.key === 'LIVE_MIN_PRIORITY')
    return t.values.priorities[option as keyof T['values']['priorities']] ?? option;
  if (def.key.startsWith('APISPORTS_PLAN'))
    return t.values.plans[option as keyof T['values']['plans']] ?? option;
  if (def.key === 'AI_PROVIDER')
    return option === 'openai' ? 'OpenAI' : option === 'anthropic' ? 'Anthropic' : option;
  return option;
}

/**
 * Estado literal da IA: "desligado", "ligado · sem limite" ou "ligado · limitado · US$ 10/dia ·
 * 2.000.000 tokens/dia" (só os tetos que existem), no idioma da pessoa.
 */
export function aiStateText(
  t: T,
  locale: Locale,
  state: { status: 'on' | 'off'; usdPerDay?: number | null; tokensPerDay?: number | null },
): string {
  const s = t.status;
  if (state.status === 'off') return s.aiOff;
  const n = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
  const limits = [
    state.usdPerDay != null ? fill(s.aiUsdPerDay, { value: n(state.usdPerDay) }) : '',
    state.tokensPerDay != null ? fill(s.aiTokensPerDay, { value: n(state.tokensPerDay) }) : '',
  ].filter(Boolean);
  return limits.length ? [s.aiOn, s.aiLimited, ...limits].join(' · ') : `${s.aiOn} · ${s.aiUnlimited}`;
}

/** Valor para leitura (efetivo, do env ou padrão), no idioma da pessoa. */
export function displayValue(
  t: T,
  def: SettingDef,
  value: string | null,
  ctx: { locale: Locale; defaultValue?: string | null; inheritPlan?: string | null } = { locale: 'pt-BR' },
): string {
  if (value === null || value === '') {
    if (def.type === 'markets') return t.values.tenantsMarkets;
    if (def.key.startsWith('APISPORTS_PLAN_'))
      return fill(t.values.inherit, {
        plan: ctx.inheritPlan ? optionLabel(t, def, ctx.inheritPlan) : t.values.empty,
      });
    if (def.defaultBy && ctx.defaultValue) return fill(t.values.providerDefault, { model: ctx.defaultValue });
    return t.values.empty;
  }
  if (value === 'unlimited') return t.values.unlimited;
  if (def.type === 'cron' && isCronOff(value)) return t.cron.off;
  if (def.type === 'enum') return optionLabel(t, def, value);
  if ((def.type === 'int' || def.type === 'number') && /^-?\d+(\.\d+)?$/.test(value)) {
    const n = new Intl.NumberFormat(ctx.locale).format(Number(value));
    const unit = settingText(t, def).unit;
    return unit ? `${n} ${unit}` : n;
  }
  if (def.type === 'markets') return value.split(',').join(' · ');
  return value;
}

/** "850 ms", "12 s", "3,5 min", "1,2 h". */
export function formatDuration(locale: Locale, ms: number): string {
  const unit = (n: number, u: string, digits = 0) =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: u,
      unitDisplay: 'short',
      maximumFractionDigits: digits,
    }).format(n);
  if (ms < 1000) return unit(ms, 'millisecond');
  if (ms < 60_000) return unit(ms / 1000, 'second', ms < 10_000 ? 1 : 0);
  if (ms < 3_600_000) return unit(ms / 60_000, 'minute', 1);
  return unit(ms / 3_600_000, 'hour', 1);
}

/**
 * Tokens do dia como o serviço conta: os agentes de pool próprio (SEPARATE_TOKEN_POOLS, ex.: `assets`)
 * ficam fora da soma contra o AI_DAILY_TOKEN_BUDGET e aparecem à parte, contra o próprio pool.
 */
export function tokenUsage(
  byAgent: readonly { agent: string; inputTokens: number; outputTokens: number }[],
  budget: number | null,
): { counted: number; pools: { agent: string; used: number; limit: number | null }[] } {
  const pooled = Object.keys(SEPARATE_TOKEN_POOLS);
  const used = (a: { inputTokens: number; outputTokens: number }) => a.inputTokens + a.outputTokens;
  return {
    counted: byAgent.filter((a) => !pooled.includes(a.agent)).reduce((n, a) => n + used(a), 0),
    pools: pooled.map((agent) => ({
      agent,
      used: byAgent.filter((a) => a.agent === agent).reduce((n, a) => n + used(a), 0),
      limit: budget === null ? null : Math.round(budget * SEPARATE_TOKEN_POOLS[agent]!),
    })),
  };
}
