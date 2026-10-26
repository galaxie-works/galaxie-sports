import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiSportsClient,
  defaultPolicy,
  PgQuotaGovernor,
  PgRawStore,
  RateLimiter,
} from '@galaxie/apisports-client';
import {
  apiResponse,
  asset,
  closeDb,
  competition,
  country,
  createDb,
  providerMap,
  runMigrations,
  season,
  type Database,
} from '@galaxie/db';
import { runFootballCatalogJob, planFootballCatalog } from '../src/bootstrap/football-catalog-job.js';
import { buildCatalogRows, upsertFootballCatalog } from '../src/catalog/football-catalog.js';
import { LEAGUES } from '../src/catalog/football-catalog.test.js';
import { importRawDirectory } from '../src/raw-import.js';

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
  db = createDb(testUrl, { max: 5 });
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('upsertFootballCatalog', () => {
  it('é idempotente e mantém o mesmo ID quando a competição entra no catálogo depois', async () => {
    const countries = [{ name: 'Brazil', code: 'BR', flag: 'https://media.api-sports.io/flags/br.svg' }];
    const first = await upsertFootballCatalog(db, buildCatalogRows(LEAGUES, countries, []));
    expect(first.competitions).toEqual({ inserted: 4, updated: 0 });
    const [before] = await db
      .select({ id: providerMap.entityId })
      .from(providerMap)
      .where(eq(providerMap.providerId, '71'));
    const [anon] = await db.select().from(competition).where(eq(competition.id, before!.id));
    expect(anon).toMatchObject({ slug: 'brazil-serie-a-71', tier: 3 });

    // brasileiro preenchido manualmente não pode ser apagado pela atualização em inglês
    await db
      .update(country)
      .set({ name: { en: 'Brazil', 'pt-BR': 'Brasil' } })
      .where(eq(country.code, 'BR'));

    const catalog = [
      {
        slug: 'brasileirao-serie-a',
        name: 'Serie A',
        country: 'Brazil',
        type: 'league' as const,
        api_sports_id: 71,
        tier: 1,
        live_priority: 'high' as const,
      },
    ];
    const second = await upsertFootballCatalog(db, buildCatalogRows(LEAGUES, countries, catalog));
    expect(second.competitions).toEqual({ inserted: 0, updated: 4 });

    const [after] = await db.select().from(competition).where(eq(competition.id, before!.id));
    expect(after).toMatchObject({ slug: 'brasileirao-serie-a', tier: 1, livePriority: 'high' });
    expect((await db.select().from(competition)).length).toBe(4);
    expect((await db.select().from(season)).length).toBe(4);
    const [br] = await db.select().from(country).where(eq(country.code, 'BR'));
    expect(br?.name).toEqual({ en: 'Brazil', 'pt-BR': 'Brasil' });
    expect(br?.flagAssetId).not.toBeNull();
    expect((await db.select().from(asset)).length).toBe(5); // 2 bandeiras + 3 logos
  });
});

describe('importRawDirectory', () => {
  it('importa envelopes salvos e não duplica na segunda vez', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'raw-'));
    await mkdir(join(dir, 'football'));
    const body = JSON.stringify({
      get: 'leagues',
      parameters: [],
      errors: [],
      results: 4,
      paging: { current: 1, total: 1 },
      response: LEAGUES,
    });
    // Carimbo relativo a agora (1 h atrás): o /leagues no raw vale 1 dia, e o teste seguinte depende dele
    // ainda estar fresco. Com data fixa o teste quebrava 24 h depois de escrito.
    const stamp = new Date(Math.floor((Date.now() - 3_600_000) / 1000) * 1000);
    const fileStamp = stamp.toISOString().replace(/[-:]/g, '').replace('.000', '');
    await writeFile(join(dir, 'football', `leagues__${fileStamp}.json`), body);
    await writeFile(join(dir, 'notas.json'), '{"x":1}');
    // sem a data da coleta no nome: com a hora da importação, viraria a observação mais nova do /teams
    const undated = join(dir, 'football', 'teams.json');
    await writeFile(
      undated,
      JSON.stringify({ get: 'teams', parameters: { id: '1' }, errors: [], results: 0, response: [] }),
    );
    try {
      const a = await importRawDirectory(db, dir);
      const b = await importRawDirectory(db, dir);
      expect(a.skipped.find((s) => s.file === undated)?.reason).toMatch(/sem a data da coleta/);
      const imported = await db.select().from(apiResponse).where(eq(apiResponse.jobId, 'raw-import'));
      expect(imported.map((r) => r.endpoint)).toEqual(['/leagues']);
      expect(a).toMatchObject({ imported: 1, duplicates: 0 });
      expect(b).toMatchObject({ imported: 0, duplicates: 1 });
      const [row] = await db.select().from(apiResponse).where(eq(apiResponse.endpoint, '/leagues'));
      expect(row?.fetchedAt.toISOString()).toBe(stamp.toISOString());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runFootballCatalogJob', () => {
  it('reaproveita o raw e só chama o fornecedor para o que falta', async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      const response = url.pathname === '/countries' ? [{ name: 'Brazil', code: 'BR', flag: null }] : [];
      return new Response(
        JSON.stringify({
          get: url.pathname.slice(1),
          parameters: [],
          errors: [],
          results: response.length,
          paging: { current: 1, total: 1 },
          response,
        }),
      );
    }) as typeof globalThis.fetch;
    const governor = new PgQuotaGovernor(db, () => defaultPolicy(100));
    // dia sem ao vivo: libera a folga para o BOOTSTRAP (sem isso a política padrão só cede 5 chamadas)
    await governor.plan('football', new Date().toISOString().slice(0, 10), { LIVE: 0, DAILY: 0 });
    const client = new ApiSportsClient({
      apiKey: 'k',
      store: new PgRawStore(db),
      governor,
      fetch: fetchFn,
      rateLimiter: new RateLimiter(6000),
    });

    // /leagues já está no raw (teste anterior); o plano deve mostrar isso
    const plan = await planFootballCatalog(db);
    expect(plan.find((p) => p.endpoint === '/leagues')?.source).toBe('cache');

    const result = await runFootballCatalogJob(db, client, []);
    expect(calls).not.toContain('/leagues');
    expect(calls).toHaveLength(7);
    expect(result.stats.competitions.updated).toBe(4);
  });
});
