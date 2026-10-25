import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@galaxie/db';

/*
 * Biblioteca de emissoras que a operadora pode pedir para incluir num plano ("Falta um canal"), contra
 * um Postgres descartável com as migrations reais: rádio não é canal de grade e fica de fora.
 */

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let server: typeof import('../src/lib/lineup/server');

beforeAll(async () => {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  await runMigrations(testUrl);
  const sql = new Client({ connectionString: testUrl });
  await sql.connect();
  await sql.query(
    `insert into enrich.broadcaster (id, name, kind, countries, markets) values
       ('tv-aberta', 'TV Aberta Exemplo', 'free_tv', '{BR}', '{}'),
       ('tv-paga', 'Canal Pago Exemplo', 'pay_tv', '{BR}', '{}'),
       ('streaming', 'Streaming Exemplo', 'streaming', '{BR}', '{}'),
       ('radio', 'Rádio Exemplo', 'radio', '{BR}', '{}'),
       ('tv-ar', 'TV Argentina Exemplo', 'free_tv', '{AR}', '{}')`,
  );
  await sql.end();
  // o pool da demo lê a URL ao ser importado
  process.env.DEMO_DATABASE_URL = testUrl;
  server = await import('../src/lib/lineup/server');
});

afterAll(async () => {
  const { pool } = await import('../src/lib/auth/db');
  await pool.end();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

describe('readCountryLibrary', () => {
  it('canais de TV e streamings do país, sem rádio', async () => {
    const library = await server.readCountryLibrary('BR');
    expect(library.map((e) => [e.id, e.kind])).toEqual([
      ['tv-paga', 'pay_tv'],
      ['streaming', 'streaming'],
      ['tv-aberta', 'free_tv'],
    ]);
  });
});
