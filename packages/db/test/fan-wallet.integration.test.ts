import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  creditPoints,
  debitBalance,
  readLedger,
  readWallets,
  revertPoints,
  runMigrations,
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
let pg: postgres.Sql;
let db: Database;
let tenantId: string;
let otherTenant: string;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  pg = postgres(testUrl, { max: 2, onnotice: () => {} });
  const tenant = async (slug: string) =>
    (
      await pg`insert into api.tenant (slug, name, plan, modules)
        values (${slug}, ${slug}, 'enterprise', ${['gamification']}) returning id`
    )[0]!.id as string;
  tenantId = await tenant('carteira-a');
  otherTenant = await tenant('carteira-b');
}, 60_000);

afterAll(async () => {
  await pg?.end();
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

let seq = 0;
async function profile(ageBand: 'under13' | '13_17' | '18plus', tenant = tenantId): Promise<string> {
  seq += 1;
  const [acc] = await pg`insert into fan.account (tenant_id, external_account_id)
    values (${tenant}, ${`acc_${seq}`}) returning id`;
  const [prof] = await pg`insert into fan.profile
      (tenant_id, account_id, external_profile_id, nickname, age_band, country, locale)
    values (${tenant}, ${acc!.id}, ${`prof_${seq}`}, ${`Torcedor${seq}`}, ${ageBand}, 'BR', 'pt-BR') returning id`;
  return prof!.id as string;
}

const key = (profileId: string, programCountry = 'BR', tenant = tenantId) => ({
  tenantId: tenant,
  profileId,
  programCountry,
});

describe('carteira de pontos (B6, #938)', () => {
  it('credita Pontos e Saldo juntos e o extrato guarda o valor depois de cada lançamento', async () => {
    const p = await profile('18plus');
    const a = await creditPoints(db, {
      ...key(p),
      amount: 30,
      reason: 'prediction',
      source: 'gamification',
      sourceEvent: 'palpite:1',
    });
    const b = await creditPoints(db, {
      ...key(p),
      amount: 12,
      reason: 'achievement',
      source: 'gamification',
      sourceEvent: 'conquista:7',
    });
    expect(a.ok && b.ok).toBe(true);
    expect(await readWallets(db, tenantId, p)).toEqual([{ programCountry: 'BR', points: 42, balance: 42 }]);
    const ledger = await readLedger(db, key(p), { limit: 10 });
    expect(ledger.map((e) => [e.reason, e.pointsDelta, e.pointsAfter, e.balanceAfter])).toEqual([
      ['achievement', 12, 42, 42],
      ['prediction', 30, 30, 30],
    ]);
  });

  it('reprocessar o mesmo evento não duplica', async () => {
    const p = await profile('18plus');
    const input = {
      ...key(p),
      amount: 10,
      reason: 'presence' as const,
      source: 'live_chat' as const,
      sourceEvent: 'jogo:99:janela:3',
    };
    const first = await creditPoints(db, input);
    const again = await creditPoints(db, input);
    const parallel = await Promise.all([creditPoints(db, input), creditPoints(db, input)]);
    expect(first.ok && !first.duplicate).toBe(true);
    expect(again.ok && again.duplicate && again.entry.id === (first.ok ? first.entry.id : '')).toBe(true);
    expect(parallel.every((r) => r.ok && r.duplicate)).toBe(true);
    expect((await readWallets(db, tenantId, p))[0]!.points).toBe(10);
    expect(await readLedger(db, key(p), { limit: 10 })).toHaveLength(1);
  });

  it('créditos em paralelo de eventos diferentes somam certo', async () => {
    const p = await profile('18plus');
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        creditPoints(db, {
          ...key(p),
          amount: 5,
          reason: 'trivia',
          source: 'gamification',
          sourceEvent: `trivia:${i}`,
        }),
      ),
    );
    expect(await readWallets(db, tenantId, p)).toEqual([{ programCountry: 'BR', points: 50, balance: 50 }]);
  });

  it('reverter o evento estorna; estornar de novo não tira duas vezes', async () => {
    const p = await profile('13_17');
    const ev = {
      reason: 'prediction' as const,
      source: 'gamification' as const,
      sourceEvent: 'palpite:gol-anulado',
    };
    await creditPoints(db, { ...key(p), amount: 20, ...ev });
    const r1 = await revertPoints(db, { ...key(p), ...ev, note: 'gol anulado pelo VAR' });
    const r2 = await revertPoints(db, { ...key(p), ...ev });
    expect(r1.ok && r1.entry.pointsDelta === -20 && r1.entry.balanceDelta === -20).toBe(true);
    expect(r2.ok && r2.duplicate).toBe(true);
    expect(await readWallets(db, tenantId, p)).toEqual([{ programCountry: 'BR', points: 0, balance: 0 }]);
    expect(await revertPoints(db, { ...key(p), ...ev, sourceEvent: 'nao-existe' })).toEqual({
      ok: false,
      error: 'entry_not_found',
    });
  });

  it('resgate gasta só o Saldo; Pontos e Ranking ficam', async () => {
    const p = await profile('18plus');
    await creditPoints(db, {
      ...key(p),
      amount: 100,
      reason: 'achievement',
      source: 'gamification',
      sourceEvent: 'c:1',
    });
    const d = await debitBalance(db, {
      ...key(p),
      amount: 70,
      source: 'gamification',
      sourceEvent: 'resgate:1',
    });
    expect(d.ok).toBe(true);
    expect(await readWallets(db, tenantId, p)).toEqual([{ programCountry: 'BR', points: 100, balance: 30 }]);
    expect(
      await debitBalance(db, { ...key(p), amount: 31, source: 'gamification', sourceEvent: 'resgate:2' }),
    ).toEqual({
      ok: false,
      error: 'insufficient_balance',
    });
    // estorno depois do resgate tira os Pontos inteiros e só o Saldo que sobrou
    const r = await revertPoints(db, {
      ...key(p),
      reason: 'achievement',
      source: 'gamification',
      sourceEvent: 'c:1',
    });
    expect(r.ok && r.entry.pointsDelta === -100 && r.entry.balanceDelta === -30).toBe(true);
    expect(await readWallets(db, tenantId, p)).toEqual([{ programCountry: 'BR', points: 0, balance: 0 }]);
  });

  it('13 a 17 ganha Pontos mas não resgata; menor de 13 fica fora (D1)', async () => {
    const teen = await profile('13_17');
    const kid = await profile('under13');
    const c = await creditPoints(db, {
      ...key(teen),
      amount: 5,
      reason: 'poll',
      source: 'communities',
      sourceEvent: 'e:1',
    });
    expect(c.ok).toBe(true);
    expect(
      await debitBalance(db, { ...key(teen), amount: 1, source: 'gamification', sourceEvent: 'r:1' }),
    ).toEqual({
      ok: false,
      error: 'age_restricted',
    });
    expect(
      await creditPoints(db, {
        ...key(kid),
        amount: 5,
        reason: 'poll',
        source: 'communities',
        sourceEvent: 'e:1',
      }),
    ).toEqual({
      ok: false,
      error: 'age_restricted',
    });
    expect(await readWallets(db, tenantId, kid)).toEqual([]);
  });

  it('compra e clique na loja nunca creditam', async () => {
    const p = await profile('18plus');
    await expect(
      creditPoints(db, {
        ...key(p),
        amount: 10,
        reason: 'achievement',
        // @ts-expect-error a loja não é origem de pontos
        source: 'shopping',
        sourceEvent: 'compra:1',
      }),
    ).rejects.toThrow(/não credita/);
    await expect(
      creditPoints(db, {
        ...key(p),
        amount: 10,
        // @ts-expect-error compra não é motivo
        reason: 'purchase',
        source: 'gamification',
        sourceEvent: 'compra:2',
      }),
    ).rejects.toThrow();
    // e o banco recusa mesmo sem passar pelo serviço
    await creditPoints(db, {
      ...key(p),
      amount: 1,
      reason: 'poll',
      source: 'communities',
      sourceEvent: 'ok',
    });
    await expect(
      pg`insert into fan.points_ledger (tenant_id, profile_id, program_country, reason, source, source_event,
          points_delta, balance_delta, points_after, balance_after)
        values (${tenantId}, ${p}, 'BR', 'achievement', 'shopping', 'compra:3', 5, 5, 6, 6)`,
    ).rejects.toThrow(/points_ledger_source/);
    expect((await readWallets(db, tenantId, p))[0]!.points).toBe(1);
  });

  it('extrato é append-only', async () => {
    const p = await profile('18plus');
    await creditPoints(db, { ...key(p), amount: 3, reason: 'poll', source: 'communities', sourceEvent: 'x' });
    await expect(pg`update fan.points_ledger set points_delta = 999 where profile_id = ${p}`).rejects.toThrow(
      /append-only/,
    );
  });

  it('um programa por país e isolamento entre clientes', async () => {
    const p = await profile('18plus');
    await creditPoints(db, {
      ...key(p, 'BR'),
      amount: 4,
      reason: 'poll',
      source: 'communities',
      sourceEvent: 'a',
    });
    await creditPoints(db, {
      ...key(p, 'AR'),
      amount: 6,
      reason: 'poll',
      source: 'communities',
      sourceEvent: 'a',
    });
    expect(await readWallets(db, tenantId, p)).toEqual([
      { programCountry: 'AR', points: 6, balance: 6 },
      { programCountry: 'BR', points: 4, balance: 4 },
    ]);
    // o mesmo Perfil não existe em outro cliente
    expect(
      await creditPoints(db, {
        ...key(p, 'BR', otherTenant),
        amount: 1,
        reason: 'poll',
        source: 'communities',
        sourceEvent: 'b',
      }),
    ).toEqual({ ok: false, error: 'profile_not_found' });
    expect(await readWallets(db, otherTenant, p)).toEqual([]);
  });

  it('Perfil excluído não recebe crédito novo', async () => {
    const p = await profile('18plus');
    await pg`update fan.profile set deleted_at = now(), external_profile_id = null, nickname = null
      where tenant_id = ${tenantId} and id = ${p}`;
    expect(
      await creditPoints(db, {
        ...key(p),
        amount: 1,
        reason: 'poll',
        source: 'communities',
        sourceEvent: 'z',
      }),
    ).toEqual({
      ok: false,
      error: 'profile_not_found',
    });
  });

  it('extrato paginado do mais novo para o mais antigo', async () => {
    const p = await profile('18plus');
    for (let i = 0; i < 5; i += 1)
      await creditPoints(db, {
        ...key(p),
        amount: i + 1,
        reason: 'trivia',
        source: 'gamification',
        sourceEvent: `t${i}`,
      });
    const page1 = await readLedger(db, key(p), { limit: 2 });
    const page2 = await readLedger(db, key(p), { limit: 2, before: page1.at(-1)!.id });
    expect(page1.map((e) => e.sourceEvent)).toEqual(['t4', 't3']);
    expect(page2.map((e) => e.sourceEvent)).toEqual(['t2', 't1']);
  });
});
