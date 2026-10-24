/**
 * Logos das plataformas da grade (assets:platform-logos): a entrada da biblioteca com o mesmo site
 * oficial vence; senão, o item do Wikidata com o mesmo site, o arquivo da Commons com licença livre,
 * gravado no storage com asset, crédito e o vínculo na plataforma. Idempotente; licença não livre e
 * site que não confere ficam sem logo. Wikidata e Commons falsos (fetch injetado), nomes genéricos.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asset, assetCredit, broadcaster, platform, type Database } from '@galaxie/db';
import { WikimediaClient } from '../src/assets/commons/client.js';
import { InMemoryObjectStore } from '../src/assets/object-store.js';
import { platformsWithoutLogo, runPlatformLogos } from '../src/assets/platform-logos.js';
import { disposableDb } from './db.js';
import { encodePng, solidRgba } from './png.js';

const testDb = disposableDb();
let db: Database;
const ids = { library: '', commons: '', nonFree: '', noSite: '', rejected: '' };

const png = encodePng({
  width: 4,
  height: 2,
  colorType: 6,
  rows: [...Array(2)].map((_, y) => [
    ...solidRgba(4, 2, [{ color: [10, 20, 200], share: 1 }]).slice(y * 16, y * 16 + 16),
  ]),
});

/** Wikidata e Commons falsos: busca, entidades (site e logo) e imageinfo com a licença de cada arquivo. */
function fakeWikimedia(licenses: Record<string, string>) {
  const entities = {
    Q100: {
      labels: { pt: { value: 'Operadora Exemplo' } },
      claims: {
        P856: [{ mainsnak: { datavalue: { value: 'https://www.operadora.example/' } } }],
        P154: [{ mainsnak: { datavalue: { value: 'Operadora Exemplo logo.svg' } } }],
      },
    },
    Q200: {
      labels: { en: { value: 'Streaming Fechado' } },
      claims: {
        P856: [{ mainsnak: { datavalue: { value: 'https://fechado.example' } } }],
        P154: [{ mainsnak: { datavalue: { value: 'Fechado logo.png' } } }],
      },
    },
  };
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === 'upload.wikimedia.org')
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    const action = url.searchParams.get('action');
    if (action === 'wbsearchentities') {
      const q = url.searchParams.get('search') ?? '';
      const hits = q.startsWith('Operadora') ? ['Q100'] : q.startsWith('Streaming') ? ['Q200'] : [];
      return Response.json({ search: hits.map((id) => ({ id })) });
    }
    if (action === 'wbgetentities') {
      const want = (url.searchParams.get('ids') ?? '').split('|');
      return Response.json({
        entities: Object.fromEntries(Object.entries(entities).filter(([id]) => want.includes(id))),
      });
    }
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
              width: 2000,
              height: 1000,
              mime: 'image/svg+xml',
              extmetadata: {
                License: { value: licenses[title] },
                LicenseShortName: { value: licenses[title] === 'pd' ? 'Public domain' : licenses[title] },
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
    fetch: fakeWikimedia({
      'File:Operadora Exemplo logo.svg': 'pd',
      'File:Fechado logo.png': 'Non-free logo',
    }),
    minIntervalMs: 0,
    sleep: async () => {},
  });

beforeAll(async () => {
  db = await testDb.setup();
  // biblioteca de emissoras: um streaming com logo já no storage e site oficial
  const [lib] = await db
    .insert(asset)
    .values({
      kind: 'broadcaster_logo',
      sourceUrl: 'acervo-oficial://1:1',
      storageKey: 'broadcasters/abc.svg',
      origin: 'acervo',
    })
    .returning();
  await db.insert(broadcaster).values({
    id: 'streaming_exemplo',
    name: 'Streaming Exemplo',
    kind: 'streaming',
    countries: ['BR'],
    markets: {} as never,
    website: 'https://streaming.example',
    logoAssetId: lib!.id,
  });
  const add = async (slug: string, name: string, website: string | null, reviewStatus = 'approved') => {
    const [p] = await db
      .insert(platform)
      .values({
        slug,
        name,
        kind: 'streaming',
        country: 'BR',
        website,
        reviewStatus: reviewStatus as 'approved',
      })
      .returning();
    return p!.id;
  };
  ids.library = await add('br-streaming-exemplo', 'Streaming Exemplo', 'https://www.streaming.example/br');
  ids.commons = await add('br-operadora-exemplo', 'Operadora Exemplo', 'https://operadora.example/para-voce');
  ids.nonFree = await add('br-streaming-fechado', 'Streaming Fechado', 'https://fechado.example');
  ids.noSite = await add('br-sem-site', 'Operadora Sem Site', null);
  ids.rejected = await add('br-rejeitada', 'Operadora Exemplo', 'https://operadora.example', 'rejected');
}, 120_000);

afterAll(async () => {
  await testDb.teardown();
});

describe('assets:platform-logos', () => {
  it('prévia: diz o que ligaria sem gravar nada', async () => {
    const objects = new InMemoryObjectStore();
    const targets = await platformsWithoutLogo(db);
    expect(targets.map((t) => t.slug)).not.toContain('br-rejeitada');
    const report = await runPlatformLogos({ db, client: client(), objects, targets, dryRun: true });
    expect(Object.fromEntries(report.outcomes.map((o) => [o.slug, o.status]))).toEqual({
      'br-operadora-exemplo': 'commons',
      'br-sem-site': 'skipped',
      'br-streaming-exemplo': 'library',
      'br-streaming-fechado': 'skipped',
    });
    expect(objects.objects.size).toBe(0);
    const rows = await db.select({ logo: platform.logoAssetId }).from(platform);
    expect(rows.every((r) => r.logo === null)).toBe(true);
  });

  it('grava o logo da Commons com o crédito e reaproveita o da biblioteca', async () => {
    const objects = new InMemoryObjectStore();
    const report = await runPlatformLogos({
      db,
      client: client(),
      objects,
      targets: await platformsWithoutLogo(db),
    });
    const skipped = report.outcomes.filter((o) => o.status === 'skipped');
    expect(skipped.map((o) => [o.slug, o.status === 'skipped' && o.reason])).toEqual([
      ['br-sem-site', 'sem site oficial para conferir'],
      ['br-streaming-fechado', 'File:Fechado logo.png: não livre'],
    ]);

    const [lib] = await db
      .select({ logo: platform.logoAssetId })
      .from(platform)
      .where(eq(platform.id, ids.library));
    const [libAsset] = await db
      .select({ id: broadcaster.logoAssetId })
      .from(broadcaster)
      .where(eq(broadcaster.id, 'streaming_exemplo'));
    expect(lib!.logo).toBe(libAsset!.id);

    const [row] = await db
      .select({ a: asset, c: assetCredit })
      .from(platform)
      .innerJoin(asset, eq(asset.id, platform.logoAssetId))
      .innerJoin(assetCredit, eq(assetCredit.assetId, asset.id))
      .where(eq(platform.id, ids.commons));
    expect(row!.a).toMatchObject({
      kind: 'broadcaster_logo',
      origin: 'commons',
      sourceUrl: 'commons://File:Operadora Exemplo logo.svg',
      width: 4,
      height: 2,
    });
    expect(row!.a.storageKey).toMatch(/^platforms\/[0-9a-f]{16}\.png$/);
    expect(objects.objects.has(row!.a.storageKey!)).toBe(true);
    expect(row!.c).toMatchObject({
      source: 'wikimedia-commons',
      title: 'File:Operadora Exemplo logo.svg',
      pageUrl: 'https://commons.wikimedia.org/wiki/File%3AOperadora%20Exemplo%20logo.svg',
      license: 'Public domain',
      attributionRequired: false,
      originalWidth: 2000,
    });

    // idempotente: sem logo pendente além dos que não têm fonte verificável
    const again = await platformsWithoutLogo(db);
    expect(again.map((t) => t.slug)).toEqual(['br-sem-site', 'br-streaming-fechado']);
    // refazer regrava no mesmo asset (mesma origem), sem duplicar
    await runPlatformLogos({
      db,
      client: client(),
      objects,
      targets: await platformsWithoutLogo(db, { force: true, slug: 'br-operadora-exemplo' }),
    });
    const assets = await db.select().from(asset).where(eq(asset.origin, 'commons'));
    expect(assets).toHaveLength(1);
  });
});
