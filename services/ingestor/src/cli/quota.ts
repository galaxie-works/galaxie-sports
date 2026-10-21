/**
 * Relatório de cota: lê /status das APIs (não consome cota), reconcilia o Governor e imprime o uso do dia.
 * Uso: pnpm --filter @galaxie/ingestor quota [football basketball ...]
 */
import {
  API_SPORTS,
  ApiSportsClient,
  defaultPolicy,
  PgQuotaGovernor,
  PgRawStore,
  planByName,
  PlanRules,
  type ApiSport,
} from '@galaxie/apisports-client';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';

const { APISPORTS_KEY, DATABASE_URL, APISPORTS_PLAN, QUOTA_RESERVE_PERCENT } = process.env;
if (!APISPORTS_KEY || !DATABASE_URL) throw new Error('Defina APISPORTS_KEY e DATABASE_URL (.env).');

const plan = planByName(APISPORTS_PLAN);
const db = createDb(DATABASE_URL);
const governor = new PgQuotaGovernor(db, () =>
  defaultPolicy(plan.dailyLimit, Number(QUOTA_RESERVE_PERCENT ?? 15)),
);
const client = new ApiSportsClient({
  apiKey: APISPORTS_KEY,
  store: new PgRawStore(db),
  governor,
  plan: new PlanRules(plan),
});

const sports = (process.argv.slice(2).length ? process.argv.slice(2) : API_SPORTS) as ApiSport[];
const rows = [];
for (const sport of sports) {
  const status = await client.status(sport);
  const usage = await governor.usage(sport);
  rows.push({
    api: sport,
    plano: status.plan,
    fornecedor: `${status.used}/${status.limitDay}`,
    ledger: usage.totalUsed,
    daily: `${usage.used.DAILY}/${usage.budget.DAILY}`,
    live: `${usage.used.LIVE}/${usage.budget.LIVE}`,
    bootstrap: usage.used.BOOTSTRAP,
    reserva: usage.reserve,
  });
}
report('Cota do dia por API', rows);
await closeDb(db);
