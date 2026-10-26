/**
 * Relatório de cota: lê /status das APIs (não consome cota), reconcilia o Governor e imprime o uso do dia.
 * O plano configurado é por API (APISPORTS_PLAN_<ESPORTE>, senão APISPORTS_PLAN).
 * Uso: pnpm --filter @galaxie/ingestor quota [football basketball ...]
 */
import {
  API_SPORTS,
  ApiSportsClient,
  PgQuotaGovernor,
  PgRawStore,
  plansFromEnv,
  PlanRules,
  type ApiSport,
} from '@galaxie/apisports-client';
import { closeDb, createDb } from '@galaxie/db';
import { quotaPolicyFromEnv } from '@galaxie/observability';
import { report } from '../logger.js';

const { APISPORTS_KEY, DATABASE_URL } = process.env;
if (!APISPORTS_KEY || !DATABASE_URL) throw new Error('Defina APISPORTS_KEY e DATABASE_URL (.env).');

const planFor = plansFromEnv(process.env);
const db = createDb(DATABASE_URL);
const governor = new PgQuotaGovernor(db, quotaPolicyFromEnv(process.env));
const client = new ApiSportsClient({
  apiKey: APISPORTS_KEY,
  store: new PgRawStore(db),
  governor,
  planFor: (sport) => new PlanRules(planFor(sport)),
});

const sports = (process.argv.slice(2).length ? process.argv.slice(2) : API_SPORTS) as ApiSport[];
const rows = [];
for (const sport of sports) {
  const status = await client.status(sport);
  const usage = await governor.usage(sport);
  rows.push({
    api: sport,
    'plano (config)': planFor(sport).name,
    plano: status.plan,
    fornecedor: `${status.used}/${status.limitDay}`,
    ledger: usage.totalUsed,
    daily: `${usage.used.DAILY}/${usage.budget.DAILY}`,
    live: `${usage.used.LIVE}/${usage.budget.LIVE}`,
    bootstrap: usage.used.BOOTSTRAP,
    reserva: usage.reserve,
    // o fornecedor respondeu "cota esgotada" há pouco: o Governor nega a API por até 15 min
    esgotada: usage.providerExhausted ? 'sim' : '',
  });
}
report('Cota do dia por API', rows);
await closeDb(db);
