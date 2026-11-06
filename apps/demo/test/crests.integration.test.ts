import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, runMigrations } from '@galaxie/db';
import { setPanelCrest } from '@galaxie/db/crests';

/*
 * Ajustes → Escudos contra um Postgres descartável com as migrations reais: a busca acha time e competição
 * sem diferenciar acento, mostra de onde vem o escudo de hoje e se Voltar vale; sem busca, os envios
 * recentes. Nomes genéricos.
 */

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let server: typeof import('../src/lib/crests/server');
const ids: Record<string, string> = {};

beforeAll(async () => {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  await runMigrations(testUrl);
  const sql = new Client({ connectionString: testUrl });
  await sql.connect();
  await sql.query(`insert into core.sport (slug, name) values ('football', '{"pt-BR":"Futebol"}'),
    ('basketball', '{"pt-BR":"Basquete"}')`);
  const { rows: assets } = await sql.query<{ id: string; source_url: string }>(
    `insert into core.asset (kind, source_url, storage_key, origin, acervo) values
       ('team_logo', 'https://media.exemplo/teams/1.png', 'teams/1.png', 'provider', null),
       ('team_logo', 'acervo://galaxie-proprio/teams/br/sao-exemplo.svg', 'acervo/football/teams/x.svg', 'acervo', 'galaxie-proprio')
     returning id::text, source_url`,
  );
  const provider = assets.find((a) => a.source_url.startsWith('https'))!.id;
  const acervo = assets.find((a) => a.source_url.startsWith('acervo'))!.id;
  const team = async (name: string, extra = '', values: unknown[] = []) =>
    (
      await sql.query<{ id: string }>(
        `insert into core.participant (sport, kind, name, country_code${extra ? `, ${extra}` : ''})
         values ('football', 'club', $1, null${values.map((_, i) => `, $${i + 2}`).join('')}) returning id::text`,
        [name, ...values],
      )
    ).rows[0]!.id;
  ids.saoExemplo = await team('São Exemplo', 'logo_asset_id, custom_logo_asset_id', [provider, acervo]);
  ids.ilheus = await team('Clube de Ilhéus', 'logo_asset_id', [provider]);
  ids.semEscudo = await team('Exemplo Sem Escudo');
  await sql.query(
    `insert into core.participant (sport, kind, name) values ('basketball', 'club', 'São Exemplo Basquete')`,
  );
  ids.liga = (
    await sql.query<{ id: string }>(
      `insert into core.competition (sport, slug, name, type) values ('football', 'liga-exemplo', 'Liga São Exemplo', 'league')
       returning id::text`,
    )
  ).rows[0]!.id;
  await sql.end();

  const db = createDb(testUrl, { max: 2 });
  await setPanelCrest(
    db,
    { type: 'team', id: ids.ilheus },
    {
      storageKey: `acervo/football/teams/${ids.ilheus}.cccccccccccc.svg`,
      sha256: 'c'.repeat(64),
      width: 100,
      height: 100,
      bytes: 10,
      palette: null,
      variants: {},
    },
    'admin@exemplo.test',
  );
  await closeDb(db);

  process.env.ASSETS_PUBLIC_BASE_URL = 'https://assets.exemplo';
  // o pool da demo lê a URL ao ser importado
  process.env.DEMO_DATABASE_URL = testUrl;
  server = await import('../src/lib/crests/server');
});

afterAll(async () => {
  const { pool } = await import('../src/lib/auth/db');
  await pool.end();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

describe('searchCrests', () => {
  it('acha time e competição do futebol sem diferenciar acento, com a origem do escudo', async () => {
    const rows = await server.searchCrests('sao exemplo', 'all');
    expect(rows.map((r) => [r.type, r.name, r.source])).toEqual([
      ['team', 'São Exemplo', 'acervo'],
      ['competition', 'Liga São Exemplo', null],
    ]);
    expect(rows[0]).toMatchObject({
      logoUrl: 'https://assets.exemplo/acervo/football/teams/x.svg',
      providerUrl: 'https://assets.exemplo/teams/1.png',
      canRevert: false,
      lastUpload: null,
    });
  });

  it('filtra por tipo e marca o escudo enviado no painel como desfazível', async () => {
    expect(await server.searchCrests('exemplo', 'competition')).toHaveLength(1);
    const [ilheus] = await server.searchCrests('ILHEUS', 'team');
    expect(ilheus).toMatchObject({ name: 'Clube de Ilhéus', source: 'panel', canRevert: true });
    expect(ilheus?.lastUpload?.by).toBe('admin@exemplo.test');
    expect(ilheus?.logoUrl).toContain(`/acervo/football/teams/${ids.ilheus}.`);
    const [semEscudo] = await server.searchCrests('sem escudo', 'all');
    expect(semEscudo).toMatchObject({ source: null, logoUrl: null });
  });

  it('texto curto não busca; curinga do LIKE é literal', async () => {
    expect(await server.searchCrests('s', 'all')).toEqual([]);
    expect(await server.searchCrests('%%', 'all')).toEqual([]);
  });
});

describe('recentCrestUploads', () => {
  it('lista os enviados no painel', async () => {
    const rows = await server.recentCrestUploads();
    expect(rows.map((r) => r.id)).toEqual([ids.ilheus]);
  });
});
