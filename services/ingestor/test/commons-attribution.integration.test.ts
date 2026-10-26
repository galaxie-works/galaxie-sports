/**
 * Backfill da atribuição pedida pelo autor (`assets:commons:atribuicao`): relê o `Attribution` da Commons só dos
 * créditos gravados sem ele e ainda não conferidos, grava em texto (sem HTML), deixa nulo o arquivo que não pede, não
 * regrava o que já tem e marca todo crédito consultado, para que rodadas com limite andem pela fila. A Commons é
 * falsa (fetch injetado).
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asset, assetCredit, competition, platform, sport, type Database } from '@galaxie/db';
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
  // fila com limite: os dois primeiros em ordem alfabética não pedem atribuição
  'File:A1 sem.svg': null,
  'File:A2 sem.svg': null,
  'File:A3 com.svg': 'Beltrano',
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
  return a!.id;
}

/** Mudanças do change feed publicadas pelo backfill (as tags que a API purga saem de entity_type:entity_id). */
const changes = async () =>
  (
    await db.execute<{ entity_type: string; entity_id: string }>(
      sql`select entity_type, entity_id from ops.change_feed where payload->>'reason' = 'commons_attribution' order by id`,
    )
  ).map((c) => `${c.entity_type}:${c.entity_id}`);
const ids: Record<string, string> = {};

const rowOf = async (title: string) =>
  (await db.select().from(assetCredit).where(eq(assetCredit.title, title)))[0]!;
const attributionOf = async (title: string) => (await rowOf(title)).attribution;
const fake = (seen: string[][] = []) =>
  new WikimediaClient({ fetch: fakeCommons(seen), minIntervalMs: 0, sleep: async () => {} });

beforeAll(async () => {
  db = await testDb.setup();
  const liga = await credit('File:Logo Liga Exemplo.svg', null);
  const operadora = await credit('File:Logo Operadora.svg', null);
  // o logo da liga é de uma competição; o da operadora (sem atribuição na Commons), de uma plataforma
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [c] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: 'liga-exemplo',
      name: 'Liga Exemplo',
      type: 'league',
      logoAssetId: liga,
    })
    .returning({ id: competition.id });
  ids.competition = c!.id;
  const [p] = await db
    .insert(platform)
    .values({
      slug: 'br-operadora',
      name: 'Operadora',
      kind: 'pay_tv_operator',
      country: 'BR',
      logoAssetId: operadora,
    })
    .returning({ id: platform.id });
  ids.operadora = p!.id;
  await credit('File:Sumiu.svg', null);
  await credit('File:Já tem.svg', 'Atribuição gravada');
}, 120_000);

afterAll(() => testDb.teardown());

describe('backfill da atribuição da Commons', () => {
  it('prévia: consulta a Commons e não grava', async () => {
    const seen: string[][] = [];
    const client = new WikimediaClient({ fetch: fakeCommons(seen), minIntervalMs: 0, sleep: async () => {} });
    const r = await backfillAttribution({ db, client, plan: true });
    expect(r).toEqual({ checked: 3, updated: 1, without: 1, missing: ['File:Sumiu.svg'], published: 0 });
    expect(await attributionOf('File:Logo Liga Exemplo.svg')).toBeNull();
    expect(await changes()).toEqual([]);
    // nem a marca de conferido
    expect((await rowOf('File:Logo Operadora.svg')).attributionCheckedAt).toBeNull();
  });

  it('grava a atribuição em texto só nos créditos sem ela; o que já tem não é relido', async () => {
    const seen: string[][] = [];
    const client = new WikimediaClient({ fetch: fakeCommons(seen), minIntervalMs: 0, sleep: async () => {} });
    const r = await backfillAttribution({ db, client });
    expect(r).toEqual({ checked: 3, updated: 1, without: 1, missing: ['File:Sumiu.svg'], published: 1 });
    // a competição do logo atualizado vai para o change feed (a API purga `competition:<id>`); a plataforma, cujo
    // logo continua sem atribuição, não
    expect(await changes()).toEqual([`competition:${ids.competition}`]);
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
    // todo crédito consultado fica marcado, com ou sem atribuição, e também o que sumiu da Commons
    for (const t of ['File:Logo Liga Exemplo.svg', 'File:Logo Operadora.svg', 'File:Sumiu.svg'])
      expect((await rowOf(t)).attributionCheckedAt, t).toBeInstanceOf(Date);
  });

  it('de novo: nada a conferir; `recheck` relê os que continuam sem atribuição', async () => {
    const seen: string[][] = [];
    expect(await backfillAttribution({ db, client: fake(seen) })).toEqual({
      checked: 0,
      updated: 0,
      without: 0,
      missing: [],
      published: 0,
    });
    expect(seen).toHaveLength(0);
    const r = await backfillAttribution({ db, client: fake(seen), recheck: true });
    expect(r).toEqual({ checked: 2, updated: 0, without: 1, missing: ['File:Sumiu.svg'], published: 0 });
    expect(await attributionOf('File:Logo Liga Exemplo.svg')).toBe('Fulano / Liga Exemplo');
  });

  it('com limite, a fila anda: os sem atribuição do começo não seguram o resto', async () => {
    await credit('File:A1 sem.svg', null);
    await credit('File:A2 sem.svg', null);
    const a3 = await credit('File:A3 com.svg', null);
    // o logo com atribuição é de uma plataforma: a mudança sai com `platform:<id>`
    const [p] = await db
      .insert(platform)
      .values({ slug: 'br-streaming', name: 'Streaming', kind: 'streaming', country: 'BR', logoAssetId: a3 })
      .returning({ id: platform.id });
    const first = await backfillAttribution({ db, client: fake(), limit: 2 });
    expect(first).toEqual({ checked: 2, updated: 0, without: 2, missing: [], published: 0 });
    expect(await attributionOf('File:A3 com.svg')).toBeNull();
    const seen: string[][] = [];
    const second = await backfillAttribution({ db, client: fake(seen), limit: 2 });
    expect(seen).toEqual([['File:A3 com.svg']]);
    expect(second).toEqual({ checked: 1, updated: 1, without: 0, missing: [], published: 1 });
    expect(await attributionOf('File:A3 com.svg')).toBe('Beltrano');
    expect((await changes()).at(-1)).toBe(`platform:${p!.id}`);
  });
});
