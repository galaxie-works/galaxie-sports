import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@galaxie/db';

/*
 * Cartão Política de IA (Ajustes → Operação → IA) e leitura do painel contra um Postgres descartável:
 * gravação das três chaves numa transação, "voltar ao padrão", budget_skipped como sucesso e o gasto do
 * dia por faixa. A sessão de admin e o idioma são simulados; o SQL é o de verdade.
 */

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: async () => ({ id: 'u-admin', email: 'teste.admin@galaxie.test', role: 'admin' }),
}));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let sql: Client;
let actions: typeof import('../src/app/[locale]/(app)/ajustes/operacao/actions');
let data: typeof import('../src/lib/ops/data');

beforeAll(async () => {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  await runMigrations(testUrl);
  sql = new Client({ connectionString: testUrl });
  await sql.connect();
  // o pool da demo lê a URL ao ser importado
  process.env.DEMO_DATABASE_URL = testUrl;
  actions = await import('../src/app/[locale]/(app)/ajustes/operacao/actions');
  data = await import('../src/lib/ops/data');
}, 120_000);

afterAll(async () => {
  await sql?.end();
  const { pool } = await import('../src/lib/auth/db');
  await pool.end();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

const overrides = async () =>
  Object.fromEntries(
    (
      await sql.query<{ key: string; value: string }>(
        `select key, value from ops.runtime_setting where key like 'AI_%' order by key`,
      )
    ).rows.map((r) => [r.key, r.value]),
  );

describe('Política de IA no painel', () => {
  it('grava as três chaves numa transação só: falha numa, nenhuma vale', async () => {
    // a 3ª gravação do histórico falha: as duas primeiras não podem ficar
    await sql.query(`
      create function falha_simulada_fn() returns trigger language plpgsql as $$
      begin
        if new.key = 'AI_P0_MIN_AUDIENCE' then raise exception 'falha simulada'; end if;
        return new;
      end $$;
      create trigger falha_simulada before insert on ops.runtime_setting_log
        for each row execute function falha_simulada_fn();`);
    const failed = await actions.saveAiPolicy({
      AI_BAND_SHARES: 'p0=50,reserve=10,p1=15,clients=10,rest=5,manual=10',
      AI_DAILY_USD_BUDGET: '12',
      AI_P0_MIN_AUDIENCE: '30',
    });
    expect(failed.ok).toBe(false);
    expect(await overrides()).toEqual({});
    await sql.query(
      'drop trigger falha_simulada on ops.runtime_setting_log; drop function falha_simulada_fn()',
    );

    const saved = await actions.saveAiPolicy({
      AI_BAND_SHARES: 'p0=50,reserve=10,p1=15,clients=10,rest=5,manual=10',
      AI_DAILY_USD_BUDGET: '12',
      AI_P0_MIN_AUDIENCE: '30',
    });
    expect(saved.ok).toBe(true);
    expect(await overrides()).toEqual({
      AI_BAND_SHARES: 'p0=50,reserve=10,p1=15,clients=10,rest=5,manual=10',
      AI_DAILY_USD_BUDGET: '12',
      AI_P0_MIN_AUDIENCE: '30',
    });
    const snap = await data.readOpsSnapshot();
    expect(snap.llm).toMatchObject({ usdBudget: 12, p0MinAudience: 30, policyOverridden: true });
  });

  it('faixas que não somam 100 são recusadas antes de gravar', async () => {
    const res = await actions.saveAiPolicy({
      AI_BAND_SHARES: 'p0=90,reserve=10,p1=15,clients=10,rest=5,manual=10',
    });
    expect(res).toMatchObject({ ok: false });
    expect((await overrides()).AI_BAND_SHARES).toBe('p0=50,reserve=10,p1=15,clients=10,rest=5,manual=10');
  });

  it('voltar ao padrão apaga as sobrescritas das três chaves e registra no histórico', async () => {
    expect((await actions.resetAiPolicy()).ok).toBe(true);
    expect(await overrides()).toEqual({});
    const log = await sql.query<{ key: string }>(
      `select key from ops.runtime_setting_log where action = 'reset' order by key`,
    );
    expect(log.rows.map((r) => r.key)).toEqual([
      'AI_BAND_SHARES',
      'AI_DAILY_USD_BUDGET',
      'AI_P0_MIN_AUDIENCE',
    ]);
    const snap = await data.readOpsSnapshot();
    expect(snap.llm).toMatchObject({ usdBudget: 10, p0MinAudience: 25, policyOverridden: false });
  });

  it('budget_skipped conta como sucesso; o gasto do dia sai por faixa e pelo dia de orçamento', async () => {
    const now = new Date('2026-10-26T15:00:00Z'); // 12:00 em Brasília: dia de orçamento 26
    await sql.query(
      `insert into ops.job_run (job, status, started_at, finished_at) values
         ('recap-run', 'error', $1, $1), ('recap-run', 'budget_skipped', $2, $2)`,
      [new Date('2026-10-26T13:00:00Z'), new Date('2026-10-26T14:00:00Z')],
    );
    await sql.query(
      `insert into ops.llm_usage (day_utc, budget_day, band, agent, purpose, provider, model, tier, cost_usd, outcome)
       values ('2026-10-26', '2026-10-26', 'p0', 'context', 'context:recap:1', 'gemini', 'm', 'standard', 1.25, 'ok'),
              ('2026-10-26', '2026-10-25', 'p1', 'context', 'context:recap:2', 'gemini', 'm', 'standard', 9, 'ok'),
              ('2026-10-26', null, null, 'wtw', 'wtw:x', 'gemini', 'm', 'research', 0.5, 'ok')`,
    );
    const snap = await data.readOpsSnapshot(now);
    expect(snap.jobs.find((j) => j.name === 'recap-run')!.lastOkAt).toBe('2026-10-26T14:00:00.000Z');
    expect(snap.llm.budgetDay).toBe('2026-10-26');
    expect(snap.llm.bands.find((b) => b.band === 'p0')).toMatchObject({ usedUsd: 1.25, limitUsd: 5.5 });
    expect(snap.llm.bands.find((b) => b.band === 'p1')).toMatchObject({ usedUsd: 0 });
    // a linha antiga (sem budget_day) conta pelo dia UTC; a do dia de orçamento 25 fica de fora
    expect(snap.llm.totals.costUsd).toBeCloseTo(1.75, 6);
  });
});
