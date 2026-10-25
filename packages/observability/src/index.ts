import { defaultPolicy, plansFromEnv, type QuotaPolicy } from '@galaxie/apisports-client';

export * from './logger.js';
export * from './metrics/registry.js';
export * from './metrics/quota.js';
export * from './metrics/queries.js';

/**
 * Mesma política do Quota Governor usada pelo ingestor, por API: o limite diário vem do plano daquela API
 * (APISPORTS_PLAN_<ESPORTE>, senão APISPORTS_PLAN), a reserva de QUOTA_RESERVE_PERCENT e o limite por minuto
 * do plano (já com o teto de APISPORTS_PER_MINUTE), que o Governor aplica somando todos os processos.
 */
export function quotaPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): (api: string) => QuotaPolicy {
  const planFor = plansFromEnv(env);
  const reserve = Number(env.QUOTA_RESERVE_PERCENT ?? 15);
  return (api) => {
    const plan = planFor(api);
    return defaultPolicy(plan.dailyLimit, reserve, plan.perMinute);
  };
}
