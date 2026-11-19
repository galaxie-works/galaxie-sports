import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asset, country, type Database } from '@galaxie/db';
import { loadGeoConfig } from '@galaxie/geo';
import { seedGeo } from '../src/geo/seed.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;
const geo = loadGeoConfig();

beforeAll(async () => {
  db = await disposable.setup();
  // como o bootstrap do catálogo grava: só o nome em inglês do fornecedor e a bandeira
  const [flag] = await db
    .insert(asset)
    .values({ kind: 'flag', sourceUrl: 'https://media.api-sports.io/flags/br.svg' })
    .returning();
  await db.insert(country).values([
    { code: 'BR', name: { en: 'Brazil' }, flagAssetId: flag!.id },
    { code: 'GB-ENG', name: { en: 'England' } },
    { code: 'US', name: { en: 'USA' } },
    { code: 'JP', name: { en: 'Japan' } },
    { code: 'WORLD', name: { en: 'World' } },
  ]);
}, 60_000);

afterAll(async () => {
  await disposable.teardown();
});

describe('geo:seed (config/geo → core.country)', () => {
  it('preenche confederação, código COI e nomes pt-BR/es preservando o en e a bandeira', async () => {
    const stats = await seedGeo(db, geo);
    // só os que o catálogo já gravou (BR, GB-ENG, US e JP); nenhum país é criado
    expect(stats.updated).toBe(4);
    expect(stats.absent).toBe(218 - 4);

    const rows = await db
      .select()
      .from(country)
      .where(inArray(country.code, ['BR', 'GB-ENG', 'US', 'JP', 'WORLD']));
    const by = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(by.BR).toMatchObject({
      confederation: 'CONMEBOL',
      iocCode: 'BRA',
      name: { en: 'Brazil', 'pt-BR': 'Brasil', es: 'Brasil' },
    });
    expect(by.BR!.flagAssetId).not.toBeNull();
    expect(by['GB-ENG']).toMatchObject({
      confederation: 'UEFA',
      iocCode: null,
      name: { en: 'England', 'pt-BR': 'Inglaterra', es: 'Inglaterra' },
    });
    expect(by.US).toMatchObject({
      confederation: 'CONCACAF',
      name: { en: 'USA', 'pt-BR': 'Estados Unidos' },
    });
    expect(by.JP).toMatchObject({ confederation: 'AFC', iocCode: 'JPN' });
    expect(by.WORLD!.confederation).toBeNull();
    // membros fora do catálogo não são criados (nem os que eram da antiga lista fixa da navegação)
    expect(
      await db
        .select()
        .from(country)
        .where(inArray(country.code, ['AI', 'AR'])),
    ).toEqual([]);
  });

  it('é idempotente', async () => {
    const before = await db.select().from(country);
    const stats = await seedGeo(db, geo);
    expect(stats.updated).toBe(4);
    const after = await db.select().from(country);
    const strip = (rows: typeof before) =>
      rows.map(({ createdAt: _c, ...r }) => r).sort((a, b) => a.code.localeCompare(b.code));
    expect(strip(after)).toEqual(strip(before));
  });

  it('o catálogo pode sobrescrever o en sem apagar as traduções', async () => {
    await db
      .insert(country)
      .values({ code: 'BR', name: { en: 'Brasil (fornecedor)' } })
      .onConflictDoUpdate({
        target: country.code,
        set: { name: { en: 'Brazil' } },
      });
    await seedGeo(db, geo);
    const [br] = await db.select().from(country).where(eq(country.code, 'BR'));
    expect(br!.name).toEqual({ en: 'Brazil', 'pt-BR': 'Brasil', es: 'Brasil' });
  });
});
