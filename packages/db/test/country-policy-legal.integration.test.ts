import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';

/* Ficha por país (#1115): apostas, consentimento de marketing e guarda legal, gravados pela migration 0150. */

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

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  pg = postgres(testUrl, { max: 2, onnotice: () => {} });
}, 60_000);

afterAll(async () => {
  await pg?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

type Row = { country: string; policy: Record<string, unknown>; version: number };
const optIn = { email: 'opt-in', push: 'opt-in', sms: 'opt-in' };
const rerun = async () => {
  const sql = readFileSync(new URL('../drizzle/0150_ficha_juridico.sql', import.meta.url), 'utf8');
  await pg.unsafe(sql);
};
const get = async (country: string) =>
  (
    await pg<Row[]>`select country, policy, version from engage.country_policy where country = ${country}`
  )[0]!;

describe('ficha por país: apostas, marketing e guarda legal (#1115)', () => {
  it('todas as fichas ganham os três campos, sem perder o resto', async () => {
    const rows = await pg<Row[]>`select country, policy, version from engage.country_policy order by country`;
    for (const r of rows) {
      expect(r.policy.bettingContent, r.country).toBe(false);
      expect(r.policy, r.country).toHaveProperty('legalHoldDays');
      expect(r.policy, r.country).toHaveProperty('parentalConsentUnder');
    }
    const by = new Map(rows.map((r) => [r.country, r.policy]));
    expect(by.get('US')).toMatchObject({
      marketingConsent: { email: 'opt-out', push: 'opt-in', sms: 'opt-in' },
      legalHoldDays: 365,
      currency: 'USD',
    });
    expect(by.get('BR')).toMatchObject({ marketingConsent: optIn, legalHoldDays: 180, currency: 'BRL' });
    expect(by.get('DEFAULT')).toMatchObject({ marketingConsent: optIn, legalHoldDays: 365 });
  });

  it('o que a ficha já tem vence, campo a campo, e quem está completa não muda de versão', async () => {
    await pg`update engage.country_policy
      set policy = (policy - 'bettingContent' - 'legalHoldDays')
        || '{"marketingConsent":{"email":"opt-out"}}'::jsonb
      where country = 'CA'`;
    const before = await get('CA');
    const brBefore = await get('BR');
    await rerun();
    const ca = await get('CA');
    expect(ca.version).toBe(before.version + 1);
    expect(ca.policy).toMatchObject({
      bettingContent: false,
      marketingConsent: { email: 'opt-out', push: 'opt-in', sms: 'opt-in' },
      legalHoldDays: 180,
    });
    expect((await get('BR')).version).toBe(brBefore.version);
  });

  it('null gravado fora do painel conta como ausente', async () => {
    await pg`update engage.country_policy
      set policy = policy
        || '{"legalHoldDays":null,"marketingConsent":{"email":null,"push":"opt-out","sms":"opt-in"}}'::jsonb
      where country = 'MX'`;
    await rerun();
    expect((await get('MX')).policy).toMatchObject({
      legalHoldDays: 180,
      marketingConsent: { email: 'opt-in', push: 'opt-out', sms: 'opt-in' },
      consentRenewalDays: null,
    });
  });

  it('país novo fora da tabela ganha o mais protetivo', async () => {
    await pg`insert into engage.country_policy (country, policy, updated_by)
      values ('UY', '{"currency":"UYU"}'::jsonb, 't')`;
    await rerun();
    expect((await get('UY')).policy).toMatchObject({
      currency: 'UYU',
      bettingContent: false,
      marketingConsent: optIn,
      legalHoldDays: 365,
    });
    const log = await pg<{ reason: string }[]>`
      select reason from engage.country_policy_log where country = 'UY' order by version`;
    expect(log.map((l) => l.reason)).toEqual(['apostas, marketing e guarda legal (#1115)']);
  });
});
