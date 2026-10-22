import { PlanViolationError } from './errors.js';
import type { Params } from './request-hash.js';

export interface PlanLimits {
  name: string;
  dailyLimit: number;
  perMinute: number;
  /** Faixa de temporadas acessível por `season` (inclusiva); undefined = todas. */
  seasons?: { min: number; max: number } | undefined;
  /** `date=` aceito só em hoje ± N dias (UTC); undefined = sem janela. */
  dateWindowDays?: number | undefined;
  forbiddenParams: string[];
  maxPage?: number | undefined;
}

/** Plano gratuito como observado em 21/10/2026 (docs/03 §1.1). */
export const FREE_PLAN: PlanLimits = {
  name: 'free',
  dailyLimit: 100,
  perMinute: 10,
  seasons: { min: 2022, max: 2024 },
  dateWindowDays: 1,
  forbiddenParams: ['ids', 'last', 'next'],
  maxPage: 3,
};

export const PRO_PLAN: PlanLimits = { name: 'pro', dailyLimit: 7500, perMinute: 300, forbiddenParams: [] };
export const ULTRA_PLAN: PlanLimits = {
  name: 'ultra',
  dailyLimit: 75000,
  perMinute: 450,
  forbiddenParams: [],
};
export const MEGA_PLAN: PlanLimits = {
  name: 'mega',
  dailyLimit: 150000,
  perMinute: 900,
  forbiddenParams: [],
};

export function planByName(name: string | undefined): PlanLimits {
  switch ((name ?? 'free').trim().toLowerCase()) {
    case 'pro':
      return PRO_PLAN;
    case 'ultra':
      return ULTRA_PLAN;
    case 'mega':
      return MEGA_PLAN;
    default:
      return FREE_PLAN;
  }
}

/** Variável do plano padrão (vale para todas as APIs sem override). */
export const PLAN_ENV = 'APISPORTS_PLAN';

/**
 * Cada API da api-sports tem assinatura e cota próprias. O override de uma API é
 * `APISPORTS_PLAN_<ESPORTE>`, com o nome da API em maiúsculas e `-` → `_`
 * (ex.: `football` → `APISPORTS_PLAN_FOOTBALL`, `formula-1` → `APISPORTS_PLAN_FORMULA_1`).
 */
export function planEnvVar(sport: string): string {
  return `${PLAN_ENV}_${sport.toUpperCase().replace(/-/g, '_')}`;
}

export type PlanEnv = Readonly<Record<string, string | undefined>>;

/** Plano de uma API: o override `APISPORTS_PLAN_<ESPORTE>` se definido (não vazio), senão `APISPORTS_PLAN`. */
export function planForSport(env: PlanEnv, sport: string): PlanLimits {
  const override = env[planEnvVar(sport)]?.trim();
  return planByName(override ? override : env[PLAN_ENV]);
}

/** Resolve o plano por API a partir do ambiente (ex.: futebol no pro, demais no free). */
export function plansFromEnv(env: PlanEnv = process.env): (sport: string) => PlanLimits {
  return (sport) => planForSport(env, sport);
}

const DAY_MS = 86_400_000;

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** "2024", "2024-2025" ou "2024/25" → 2024. */
function seasonYear(value: string | number): number | undefined {
  const m = /^(\d{4})/.exec(String(value));
  return m ? Number(m[1]) : undefined;
}

/**
 * Restrições do plano aplicadas ANTES de chamar o fornecedor — erros de plano provavelmente consomem cota.
 * Ajusta-se sozinha quando o fornecedor desloca a janela de temporadas (ex.: "try from 2023 to 2025").
 */
export class PlanRules {
  constructor(private limits: PlanLimits = FREE_PLAN) {}

  get current(): PlanLimits {
    return this.limits;
  }

  validate(params: Params = {}, now: Date = new Date()): void {
    const l = this.limits;
    for (const p of l.forbiddenParams) {
      if (params[p] !== undefined && params[p] !== '') {
        throw new PlanViolationError('forbidden_param', `O plano ${l.name} não aceita o parâmetro "${p}".`);
      }
    }
    if (l.maxPage !== undefined && params.page !== undefined && Number(params.page) > l.maxPage) {
      throw new PlanViolationError('max_page', `O plano ${l.name} limita page a ${l.maxPage}.`);
    }
    if (l.seasons && params.season !== undefined) {
      const y = seasonYear(params.season);
      if (y !== undefined && (y < l.seasons.min || y > l.seasons.max)) {
        throw new PlanViolationError(
          'season',
          `Temporada ${params.season} fora do plano ${l.name} (${l.seasons.min}–${l.seasons.max}).`,
        );
      }
    }
    if (l.dateWindowDays !== undefined && typeof params.date === 'string') {
      const target = Date.parse(`${params.date}T00:00:00Z`);
      const diffDays = Math.round((target - utcDay(now)) / DAY_MS);
      if (Number.isNaN(target) || Math.abs(diffDays) > l.dateWindowDays) {
        throw new PlanViolationError(
          'date_window',
          `Data ${params.date} fora da janela de ±${l.dateWindowDays} dia(s) do plano ${l.name}.`,
        );
      }
    }
  }

  /** Aprende com a mensagem de erro do fornecedor. Retorna true se a regra mudou. */
  learnFromPlanError(message: string): boolean {
    const m = /try from (\d{4}) to (\d{4})/i.exec(message);
    if (!m) return false;
    const seasons = { min: Number(m[1]), max: Number(m[2]) };
    if (this.limits.seasons?.min === seasons.min && this.limits.seasons.max === seasons.max) return false;
    this.limits = { ...this.limits, seasons };
    return true;
  }
}
