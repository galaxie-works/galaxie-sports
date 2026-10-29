import {
  defaultPolicy,
  DEV_MIN_RESERVE_PERCENT,
  plansFromEnv,
  PRODUCTION_RESERVE_PERCENT,
  type QuotaPolicy,
} from '@galaxie/apisports-client';

export * from './logger.js';
export * from './metrics/registry.js';
export * from './metrics/quota.js';
export * from './metrics/queries.js';

/**
 * A conta da api-sports é a mesma no dev (NAS) e na produção. Produção é APP_ENV `production` ou `staging` (as
 * stacks da VPS e do Portainer fixam `staging`); sem APP_ENV, ou com outro valor, é dev.
 */
export function isProductionQuota(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_ENV === 'production' || env.APP_ENV === 'staging';
}

/**
 * Mesma política do Quota Governor usada pelo ingestor, por API: o limite diário vem do plano daquela API
 * (APISPORTS_PLAN_<ESPORTE>, senão APISPORTS_PLAN), a reserva de QUOTA_LIVE_RESERVE_PERCENT e o limite por
 * minuto do plano (já com o teto de APISPORTS_PER_MINUTE), que o Governor aplica somando todos os processos.
 * Na produção, abaixo da reserva só o ao vivo chama. No dev, a reserva vale para tudo e é de pelo menos
 * DEV_MIN_RESERVE_PERCENT: o dev nunca encosta no que a produção precisa.
 */
export function quotaPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): (api: string) => QuotaPolicy {
  const planFor = plansFromEnv(env);
  const production = isProductionQuota(env);
  const configured = Number(env.QUOTA_LIVE_RESERVE_PERCENT || Number.NaN);
  const value = Number.isFinite(configured) ? configured : PRODUCTION_RESERVE_PERCENT;
  const reserve = production ? value : Math.max(value, DEV_MIN_RESERVE_PERCENT);
  return (api) => {
    const plan = planFor(api);
    return defaultPolicy(plan.dailyLimit, reserve, plan.perMinute, production);
  };
}
