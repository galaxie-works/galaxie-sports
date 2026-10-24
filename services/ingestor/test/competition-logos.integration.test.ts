/**
 * Logo de competição da Commons (assets:competition-logos): a competição sem logo do fornecedor ganha o
 * arquivo de licença livre, gravado no storage com asset (`origin = commons`) e crédito; um novo
 * `bootstrap:catalog` (fornecedor ainda sem logo) não o apaga; a competição com logo do fornecedor não é
 * tocada; licença não livre fica de fora. Commons falsa (fetch injetado), nomes genéricos.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asset, assetCredit, competition, type Database } from '@galaxie/db';
import { WikimediaClient } from '../src/assets/commons/client.js';
import { runCompetitionLogos } from '../src/assets/competition-logos.js';
import { InMemoryObjectStore } from '../src/assets/object-store.js';
import { upsertCatalog, type CatalogRows, type CompetitionRow } from '../src/catalog/persist.js';
import { disposableDb } from './db.js';
import { encodePng, solidRgba } from './png.js';

const testDb = disposableDb();
let db: Database;

const png = encodePng({
  width: 4,
  height: 1,
  colorType: 6,
  rows: [solidRgba(4, 1, [{ color: [220, 0, 0], share: 1 }])],
});

/** Commons falsa: imageinfo com a licença de cada arquivo e a miniatura PNG. */
function fakeCommons(licenses: Record<string, string>) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === 'upload.wikimedia.org')
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    const titles = (url.searchParams.get('titles') ?? '').split('|');
    return Response.json({
      query: {
        pages: titles.map((title) => ({
          title,
          imageinfo: [
            {
              url: `https://upload.wikimedia.org/${encodeURIComponent(title)}`,
              descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
              thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}.png`,
              width: 1200,
              height: 300,
              mime: 'image/svg+xml',
              extmetadata: {
                License: { value: licenses[title] },
                LicenseShortName: { value: licenses[title] === 'pd' ? 'Public domain' : licenses[title] },
                Artist: { value: 'Organizadora Exemplo' },
                AttributionRequired: { value: licenses[title] === 'pd' ? 'false' : 'true' },
              },
            },
          ],
        })),
      },
    });
  }) as typeof fetch;
}

const client = () =>
  new WikimediaClient({
    fetch: fakeCommons({ 'File:Campeonato.svg': 'pd', 'File:Fechado.svg': 'Non-free logo' }),
    minIntervalMs: 0,
    sleep: async () => {},
  });

const comp = (providerId: string, slug: string, logoUrl: string | null): CompetitionRow => ({
  providerId,
  slug,
  name: slug,
  labels: null,
  countryCode: 'WORLD',
  type: 'league',
  tier: 1,
  livePriority: 'high',
  logoUrl,
  seasons: [],
});

const catalog = (): CatalogRows => ({
  countries: [{ code: 'WORLD', name: { en: 'World' }, flagUrl: null }],
  competitions: [
    comp('campeonato', 'campeonato-exemplo', null),
    comp('fechado', 'campeonato-fechado', null),
    comp('com-logo', 'liga-com-logo', 'https://media.example/leagues/1.png'),
  ],
});

const logoOf = async (slug: string) => {
  const [row] = await db
    .select({ logo: competition.logoAssetId, origin: asset.origin, key: asset.storageKey })
    .from(competition)
    .leftJoin(asset, eq(asset.id, competition.logoAssetId))
    .where(eq(competition.slug, slug));
  return row!;
};

beforeAll(async () => {
  db = await testDb.setup();
  await upsertCatalog(db, 'formula-1', catalog());
});

afterAll(async () => {
  await testDb.teardown();
});

describe('logo de competição da Commons', () => {
  const entries = [
    { competition: 'campeonato-exemplo', file: 'File:Campeonato.svg' },
    { competition: 'campeonato-fechado', file: 'File:Fechado.svg' },
    { competition: 'liga-com-logo', file: 'File:Campeonato.svg' },
    { competition: 'nao-existe', file: 'File:Campeonato.svg' },
  ];

  it('liga só a competição sem logo e com licença livre, com o crédito', async () => {
    const objects = new InMemoryObjectStore();
    const outcomes = await runCompetitionLogos({ db, client: client(), objects, entries });
    expect(outcomes.map((o) => [o.competition, o.status])).toEqual([
      ['campeonato-exemplo', 'linked'],
      ['campeonato-fechado', 'skipped'],
      ['liga-com-logo', 'skipped'],
      ['nao-existe', 'skipped'],
    ]);

    const linked = await logoOf('campeonato-exemplo');
    expect(linked).toMatchObject({
      origin: 'commons',
      key: expect.stringMatching(/^competitions\/[0-9a-f]{16}\.png$/),
    });
    expect(objects.objects.has(linked.key!)).toBe(true);
    const [credit] = await db.select().from(assetCredit).where(eq(assetCredit.assetId, linked.logo!));
    expect(credit).toMatchObject({
      title: 'File:Campeonato.svg',
      license: 'Public domain',
      author: 'Organizadora Exemplo',
      attributionRequired: false,
    });
    expect((await logoOf('campeonato-fechado')).logo).toBeNull();
    expect((await logoOf('liga-com-logo')).origin).toBe('provider');
  });

  it('idempotente: a segunda execução não baixa nem muda nada', async () => {
    const before = await logoOf('campeonato-exemplo');
    const outcomes = await runCompetitionLogos({
      db,
      client: client(),
      objects: new InMemoryObjectStore(),
      entries: entries.slice(0, 1),
    });
    expect(outcomes).toEqual([
      { competition: 'campeonato-exemplo', status: 'skipped', reason: 'logo da Commons já ligado' },
    ]);
    expect((await logoOf('campeonato-exemplo')).logo).toBe(before.logo);
  });

  it('um novo catálogo do fornecedor (ainda sem logo) não apaga o da Commons', async () => {
    const before = await logoOf('campeonato-exemplo');
    await upsertCatalog(db, 'formula-1', catalog());
    expect((await logoOf('campeonato-exemplo')).logo).toBe(before.logo);
  });

  it('quando o fornecedor passa a ter logo, ele vence', async () => {
    const rows = catalog();
    rows.competitions[0] = comp('campeonato', 'campeonato-exemplo', 'https://media.example/leagues/9.png');
    await upsertCatalog(db, 'formula-1', rows);
    expect((await logoOf('campeonato-exemplo')).origin).toBe('provider');
  });
});
