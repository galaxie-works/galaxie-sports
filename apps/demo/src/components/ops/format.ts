import { isCronOff, type SettingDef } from '@galaxie/runtime-config';

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

/** Rótulo de um valor de enum (destaque do ao vivo e planos têm nome próprio). */
export function optionLabel(t: T, def: SettingDef, option: string): string {
  if (def.key === 'LIVE_FEATURED') return t.values[option as 'off' | 'auto' | 'on'] ?? option;
  if (def.key.startsWith('APISPORTS_PLAN'))
    return t.values.plans[option as keyof T['values']['plans']] ?? option;
  if (def.key === 'AI_PROVIDER')
    return option === 'openai' ? 'OpenAI' : option === 'anthropic' ? 'Anthropic' : option;
  return option;
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
