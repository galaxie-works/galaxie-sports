/**
 * Backfill da atribuição pedida pelo autor (`assets:commons:atribuicao`): relê o `Attribution` da Commons só dos
 * créditos gravados sem ele, grava em texto (sem HTML), deixa nulo o arquivo que não pede e não regrava o que já
 * tem. A Commons é falsa (fetch injetado).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asset, assetCredit, type Database } from '@galaxie/db';
import { backfillAttribution } from '../src/assets/commons/attribution.js';
import { WikimediaClient } from '../src/assets/commons/client.js';
import { disposableDb } from './db.js';

const testDb = disposableDb();
let db: Database;

/** `Attribution` de cada arquivo na Commons falsa (ausente = o arquivo não pede; fora do mapa = sumiu). */
const COMMONS: Record<string, string | null> = {
  'File:Logo Liga Exemplo.svg': '<a href="https://example.org/fulano">Fulano</a> / <i>Liga Exemplo</i>',
  'File:Logo Operadora.svg': null,
  'File:Já tem.svg': 'Outro texto',
};

function fakeCommons(seen: string[][]) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const titles = (url.searchParams.get('titles') ?? '').split('|');
    seen.push(titles);
    const pages = titles
      .filter((t) => t in COMMONS)
      .map((title) => ({
        title,
        imageinfo: [{ extmetadata: COMMONS[title] ? { Attribution: { value: COMMONS[title] } } : {} }],
      }));
    return Response.json({ query: { pages } });
  }) as typeof fetch;
}

async function credit(title: string, attribution: string | null) {
  const [a] = await db
    .insert(asset)
    .values({ kind: 'league_logo', sourceUrl: `commons://${title}`, origin: 'commons' })
    .returning({ id: asset.id });
  await db.insert(assetCredit).values({
    assetId: a!.id,
    source: 'wikimedia-commons',
    title,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    license: 'CC BY 4.0',
    credit: 'Own work',
    attribution,
  });
}

const attributionOf = async (title: string) =>
  (await db.select().from(assetCredit).where(eq(assetCredit.title, title)))[0]!.attribution;

beforeAll(async () => {
  db = await testDb.setup();
  await credit('File:Logo Liga Exemplo.svg', null);
  await credit('File:Logo Operadora.svg', null);
  await credit('File:Sumiu.svg', null);
  await credit('File:Já tem.svg', 'Atribuição gravada');
}, 120_000);

afterAll(() => testDb.teardown());

describe('backfill da atribuição da Commons', () => {
  it('prévia: consulta a Commons e não grava', async () => {
    const seen: string[][] = [];
    const client = new WikimediaClient({ fetch: fakeCommons(seen), minIntervalMs: 0, sleep: async () => {} });
    const r = await backfillAttribution({ db, client, plan: true });
    expect(r).toEqual({ checked: 3, updated: 1, without: 1, missing: ['File:Sumiu.svg'] });
    expect(await attributionOf('File:Logo Liga Exemplo.svg')).toBeNull();
  });

  it('grava a atribuição em texto só nos créditos sem ela; o que já tem não é relido', async () => {
    const seen: string[][] = [];
    const client = new WikimediaClient({ fetch: fakeCommons(seen), minIntervalMs: 0, sleep: async () => {} });
    const r = await backfillAttribution({ db, client });
    expect(r).toEqual({ checked: 3, updated: 1, without: 1, missing: ['File:Sumiu.svg'] });
    // uma requisição, sem o arquivo que já tinha atribuição
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sort()).toEqual([
      'File:Logo Liga Exemplo.svg',
      'File:Logo Operadora.svg',
      'File:Sumiu.svg',
    ]);
    expect(await attributionOf('File:Logo Liga Exemplo.svg')).toBe('Fulano / Liga Exemplo');
    expect(await attributionOf('File:Logo Operadora.svg')).toBeNull();
    expect(await attributionOf('File:Já tem.svg')).toBe('Atribuição gravada');
  });

  it('de novo: idempotente, só relê o que continua sem atribuição', async () => {
    const seen: string[][] = [];
    const client = new WikimediaClient({ fetch: fakeCommons(seen), minIntervalMs: 0, sleep: async () => {} });
    const r = await backfillAttribution({ db, client });
    expect(r).toEqual({ checked: 2, updated: 0, without: 1, missing: ['File:Sumiu.svg'] });
    expect(await attributionOf('File:Logo Liga Exemplo.svg')).toBe('Fulano / Liga Exemplo');
  });
});
