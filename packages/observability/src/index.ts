import { defaultPolicy, planByName, type QuotaPolicy } from '@galaxie/apisports-client';

export * from './logger.js';
export * from './metrics/registry.js';
export * from './metrics/quota.js';
export * from './metrics/queries.js';

/** Mesma política do Quota Governor usada pelo ingestor (APISPORTS_PLAN, QUOTA_RESERVE_PERCENT). */
export function quotaPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): (api: string) => QuotaPolicy {
  const plan = planByName(env.APISPORTS_PLAN);
  const reserve = Number(env.QUOTA_RESERVE_PERCENT ?? 15);
  return () => defaultPolicy(plan.dailyLimit, reserve);
}
