import { randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimJobRequests,
  closeDb,
  createDb,
  finishJobRequest,
  jobRequest,
  readRuntimeOverrides,
  reportRuntimeEnv,
  runMigrations,
  runtimeEnv,
  runtimeSettingLog,
  writeRuntimeSetting,
  type Database,
} from '../src/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
});

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('ops.runtime_setting', () => {
  it('grava, ignora gravação igual, volta ao padrão e registra o histórico', async () => {
    const by = 'admin@exemplo.com';
    await writeRuntimeSetting(db, { key: 'LIVE_FEATURED', value: 'auto', valueType: 'enum', by });
    await writeRuntimeSetting(db, { key: 'LIVE_FEATURED', value: 'on', valueType: 'enum', by });
    await writeRuntimeSetting(db, { key: 'LIVE_FEATURED', value: 'on', valueType: 'enum', by });
    expect((await readRuntimeOverrides(db)).get('LIVE_FEATURED')).toBe('on');

    await writeRuntimeSetting(db, { key: 'LIVE_FEATURED', value: null, valueType: 'enum', by });
    await writeRuntimeSetting(db, { key: 'LIVE_FEATURED', value: null, valueType: 'enum', by });
    expect((await readRuntimeOverrides(db)).has('LIVE_FEATURED')).toBe(false);

    const log = await db.select().from(runtimeSettingLog).orderBy(asc(runtimeSettingLog.id));
    expect(log.map((l) => [l.action, l.oldValue, l.newValue, l.changedBy])).toEqual([
      ['set', null, 'auto', by],
      ['set', 'auto', 'on', by],
      ['reset', 'on', null, by],
    ]);
  });
});

describe('ops.runtime_env', () => {
  it('substitui o relatório do serviço e apaga as chaves que saíram', async () => {
    await reportRuntimeEnv(db, 'agents', [
      { key: 'AI_PROVIDER', value: 'openai', configured: true },
      { key: 'OPENAI_API_KEY', value: null, configured: true },
    ]);
    await reportRuntimeEnv(db, 'agents', [{ key: 'AI_PROVIDER', value: 'anthropic', configured: true }]);
    await reportRuntimeEnv(db, 'ingestor', [{ key: 'LIVE_FEATURED', value: 'off', configured: true }]);
    const rows = await db.select().from(runtimeEnv).where(eq(runtimeEnv.service, 'agents'));
    expect(rows.map((r) => [r.key, r.value])).toEqual([['AI_PROVIDER', 'anthropic']]);
  });
});

describe('ops.job_request', () => {
  it('cada pedido é pego uma vez, só pelo perfil do job; os velhos expiram', async () => {
    const old = new Date(Date.now() - 60 * 60_000);
    await db.insert(jobRequest).values([
      { job: 'quota-status', requestedBy: 'a@x.com' },
      { job: 'recap-run', requestedBy: 'a@x.com' },
      { job: 'events-clock', requestedBy: 'a@x.com', requestedAt: old },
    ]);
    const jobs = ['quota-status', 'events-clock'];
    const [first, second] = await Promise.all([claimJobRequests(db, jobs), claimJobRequests(db, jobs)]);
    const claimed = [...first!, ...second!];
    expect(claimed.map((c) => c.job)).toEqual(['quota-status']);
    await finishJobRequest(db, claimed[0]!.id, { status: 'done', detail: null });

    const all = await db.select().from(jobRequest).orderBy(asc(jobRequest.job));
    expect(all.map((r) => [r.job, r.status])).toEqual([
      ['events-clock', 'expired'],
      ['quota-status', 'done'],
      ['recap-run', 'pending'],
    ]);
  });
});
