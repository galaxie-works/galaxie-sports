import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';

/* Ficha por país (#1104): regras de idade nas fichas iniciais e a ficha DEFAULT, gravadas pelas migrations 0099 e 0100. */

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

describe('ficha por país: idade e responsável (#1104)', () => {
  it('as fichas iniciais ganham as regras de idade e uma versão nova, sem perder o resto', async () => {
    const rows = await pg<Row[]>`select country, policy, version from engage.country_policy order by country`;
    const by = new Map(rows.map((r) => [r.country, r]));
    expect([...by.keys()].sort()).toEqual(
      ['AR', 'BR', 'CA', 'CL', 'CO', 'DEFAULT', 'LATAM', 'MX', 'PE', 'US'].sort(),
    );
    expect(by.get('BR')).toMatchObject({
      version: 2,
      policy: {
        currency: 'BRL',
        minAgeParticipate: 13,
        parentalConsentUnder: 16,
        guardianLinkRequiredUnder: 16,
        ageAssuranceMin: { social: 'estimated', restrictedContent: 'verified' },
        hearMinor: false,
        consentRenewalDays: null,
      },
    });
    expect(by.get('CO')!.policy).toMatchObject({ parentalConsentUnder: 18, hearMinor: true });
    expect(by.get('US')!.policy).toMatchObject({ parentalConsentUnder: 13 });
    for (const r of rows) expect(r.policy, r.country).toHaveProperty('parentalConsentUnder');
  });

  it('a ficha DEFAULT é a mais protetiva e entra no histórico', async () => {
    const [d] = await pg<
      Row[]
    >`select country, policy, version from engage.country_policy where country = 'DEFAULT'`;
    expect(d).toMatchObject({
      version: 1,
      policy: {
        parentalConsentUnder: 18,
        ageAssuranceMin: { social: 'estimated', restrictedContent: 'verified' },
        hearMinor: true,
        punishmentNoticeRequired: true,
        adsToMinors: false,
      },
    });
    const log = await pg<{ country: string; version: number; reason: string }[]>`
      select country, version, reason from engage.country_policy_log where country in ('BR', 'DEFAULT')
      order by country, version`;
    expect(log).toEqual([
      { country: 'BR', version: 1, reason: 'fichas iniciais (#954)' },
      { country: 'BR', version: 2, reason: 'idade e responsável (#1104)' },
      { country: 'DEFAULT', version: 1, reason: 'ficha DEFAULT (#1104)' },
    ]);
  });

  it('a chave aceita DEFAULT e continua recusando o que não é país, LATAM ou DEFAULT', async () => {
    await expect(
      pg`insert into engage.country_policy (country, policy, updated_by) values ('EUROPA', '{}'::jsonb, 't')`,
    ).rejects.toThrow(/country_policy_key/);
  });
});
