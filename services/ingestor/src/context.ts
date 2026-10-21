import {
  ApiSportsClient,
  defaultPolicy,
  PgQuotaGovernor,
  PgRawStore,
  planByName,
  PlanRules,
} from '@galaxie/apisports-client';
import { createDb, type Database } from '@galaxie/db';

export interface IngestorContext {
  db: Database;
  client: ApiSportsClient;
  governor: PgQuotaGovernor;
}

/** Monta banco, Governor e cliente a partir das variáveis de ambiente (.env). */
export function contextFromEnv(env: NodeJS.ProcessEnv = process.env): IngestorContext {
  const { APISPORTS_KEY, DATABASE_URL, APISPORTS_PLAN, QUOTA_RESERVE_PERCENT } = env;
  if (!DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');
  if (!APISPORTS_KEY) throw new Error('Defina APISPORTS_KEY (.env).');
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
  return { db, client, governor };
}
