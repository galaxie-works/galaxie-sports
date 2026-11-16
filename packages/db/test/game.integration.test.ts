import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appendGameAudit,
  applyRoles,
  changeGameRules,
  closeDb,
  createDb,
  ensureGameProgram,
  eraseGame,
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
let tenantA: string;
let tenantB: string;

const RULES_V1 = { winner: 40, exactScore: 120 };
const RULES_V2 = { winner: 50, exactScore: 150 };

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
  tenantA = await tenant('game-a');
  tenantB = await tenant('game-b');
}, 60_000);

afterAll(async () => {
  await pg?.end();
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

let seq = 0;
async function profile(tenantId: string, country = 'BR'): Promise<string> {
  seq += 1;
  const [acc] = await pg`insert into fan.account (tenant_id, external_account_id)
    values (${tenantId}, ${`acc-${seq}`}) returning id`;
  const [p] =
    await pg`insert into fan.profile (tenant_id, account_id, external_profile_id, age_band, country, locale)
    values (${tenantId}, ${acc!.id}, ${`p-${seq}`}, '18plus', ${country}, 'pt-BR') returning id`;
  return p!.id as string;
}

async function predict(
  tenantId: string,
  country: string,
  profileId: string,
  eventId: string,
  ruleVersion: number,
) {
  await pg`insert into game.prediction (tenant_id, program_country, profile_id, event_id, kind, value, lock_at, rule_version)
    values (${tenantId}, ${country}, ${profileId}, ${eventId}, 'winner', ${pg.json({ kind: 'winner', pick: 'home' })},
      now() + interval '1 hour', ${ruleVersion})`;
}

describe('schema game', () => {
  it('programa nasce com a versão 1 e é idempotente', async () => {
    const v = await ensureGameProgram(db, {
      tenantId: tenantA,
      programCountry: 'BR',
      timeZone: 'America/Sao_Paulo',
      rules: RULES_V1,
      changedBy: 'system',
    });
    expect(v).toBe(1);
    expect(
      await ensureGameProgram(db, {
        tenantId: tenantA,
        programCountry: 'BR',
        timeZone: 'America/Sao_Paulo',
        rules: RULES_V2,
        changedBy: 'system',
      }),
    ).toBe(1);
    const rows = await pg`select version, rules from game.rule_version where tenant_id = ${tenantA}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rules).toEqual(RULES_V1);
  });

  it('isolamento: cliente e país diferentes nunca se misturam', async () => {
    await ensureGameProgram(db, {
      tenantId: tenantA,
      programCountry: 'AR',
      timeZone: 'America/Argentina/Buenos_Aires',
      rules: RULES_V1,
      changedBy: 'system',
    });
    await ensureGameProgram(db, {
      tenantId: tenantB,
      programCountry: 'BR',
      timeZone: 'America/Sao_Paulo',
      rules: RULES_V1,
      changedBy: 'system',
    });
    const event = randomUUID();
    const pa = await profile(tenantA);
    const pb = await profile(tenantB);
    await predict(tenantA, 'BR', pa, event, 1);
    await predict(tenantA, 'AR', pa, event, 1);
    await predict(tenantB, 'BR', pb, event, 1);

    const onlyA_BR = await pg`select profile_id from game.prediction
      where tenant_id = ${tenantA} and program_country = 'BR' and event_id = ${event}`;
    expect(onlyA_BR.map((r) => r.profile_id)).toEqual([pa]);

    // o Perfil de um cliente não entra no programa de outro: a chave composta recusa
    await expect(predict(tenantB, 'BR', pa, randomUUID(), 1)).rejects.toThrow(/prediction_profile_fk/);
    // programa que não existe no cliente também é recusado
    await expect(predict(tenantB, 'AR', pb, randomUUID(), 1)).rejects.toThrow(/prediction_program_fk/);
  });

  it('um Palpite por Perfil, jogo, tipo e assunto', async () => {
    const p = await profile(tenantA);
    const event = randomUUID();
    await predict(tenantA, 'BR', p, event, 1);
    await expect(predict(tenantA, 'BR', p, event, 1)).rejects.toThrow(/prediction_profile_event_uq/);
  });

  it('mudança de regra não altera o que já foi ganho', async () => {
    const p = await profile(tenantA);
    await predict(tenantA, 'BR', p, randomUUID(), 1);
    await pg`insert into game.step_grant (tenant_id, program_country, profile_id, achievement_id, step, threshold, bonus_points, rule_version, source_event)
      values (${tenantA}, 'BR', ${p}, 'loyalty.watched', 1, 1, 0, 1, 'event:x')`;

    const v2 = await changeGameRules(db, {
      tenantId: tenantA,
      programCountry: 'BR',
      rules: RULES_V2,
      changedBy: 'galaxie:1',
      note: 'escala nova',
    });
    expect(v2).toBe(2);

    const [prog] =
      await pg`select rule_version from game.program where tenant_id = ${tenantA} and program_country = 'BR'`;
    expect(prog!.rule_version).toBe(2);
    const versions = await pg`select version, rules from game.rule_version
      where tenant_id = ${tenantA} and program_country = 'BR' order by version`;
    expect(versions.map((r) => [r.version, r.rules])).toEqual([
      [1, RULES_V1],
      [2, RULES_V2],
    ]);
    const [grant] =
      await pg`select rule_version from game.step_grant where tenant_id = ${tenantA} and profile_id = ${p}`;
    expect(grant!.rule_version).toBe(1);
    const [pred] =
      await pg`select rule_version from game.prediction where tenant_id = ${tenantA} and profile_id = ${p}`;
    expect(pred!.rule_version).toBe(1);
    // o outro país do mesmo cliente segue na versão dele
    const [ar] =
      await pg`select rule_version from game.program where tenant_id = ${tenantA} and program_country = 'AR'`;
    expect(ar!.rule_version).toBe(1);
  });

  it('nenhuma tabela tem coluna de compra ou pagamento', async () => {
    const cols = await pg`select table_name, column_name from information_schema.columns
      where table_schema = 'game' and column_name ~ '(purchase|order|payment|price|shop|checkout)'`;
    expect(cols).toEqual([]);
  });

  it('exclusão do torcedor apaga o que é dele e mantém a auditoria', async () => {
    const p = await profile(tenantA);
    await predict(tenantA, 'BR', p, randomUUID(), 1);
    await pg`insert into game.period_points (tenant_id, program_country, period, profile_id, points) values (${tenantA}, 'BR', '2026-11', ${p}, 40)`;
    await appendGameAudit(db, {
      tenantId: tenantA,
      programCountry: 'BR',
      profileId: p,
      kind: 'prediction.scored',
      subject: 'x',
      ruleVersion: 1,
    });
    await db.transaction((tx) => eraseGame(tx, tenantA, p));
    const [left] = await pg`select
      (select count(*) from game.prediction where profile_id = ${p})::int as preds,
      (select count(*) from game.period_points where profile_id = ${p})::int as pts,
      (select count(*) from game.audit_log where profile_id = ${p})::int as audit`;
    expect(left).toEqual({ preds: 0, pts: 0, audit: 1 });
  });
});

describe('papéis', () => {
  it('a API só acrescenta na auditoria; o resto do schema ela escreve', async () => {
    const prefix = `t${randomBytes(3).toString('hex')}_`;
    await applyRoles(testUrl, { prefix });
    try {
      const priv = async (table: string, p: string) =>
        (await pg`select has_table_privilege(${`${prefix}api`}, ${`game.${table}`}, ${p}) as ok`)[0]!
          .ok as boolean;
      expect(await priv('audit_log', 'INSERT')).toBe(true);
      expect(await priv('audit_log', 'UPDATE')).toBe(false);
      expect(await priv('audit_log', 'DELETE')).toBe(false);
      expect(await priv('prediction', 'UPDATE')).toBe(true);
      expect(await priv('prediction', 'DELETE')).toBe(true);
      // dado do torcedor: agentes e ingestor não leem
      expect(
        (await pg`select has_schema_privilege(${`${prefix}agents`}, 'game', 'USAGE') as ok`)[0]!.ok,
      ).toBe(false);
    } finally {
      const roles = await pg`select rolname from pg_roles where rolname like ${`${prefix}%`}`;
      for (const r of roles) {
        await pg.unsafe(`DROP OWNED BY "${r.rolname}"; DROP ROLE "${r.rolname}"`);
      }
    }
  });
});
