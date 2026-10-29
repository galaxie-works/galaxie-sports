import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  availabilityForChannels,
  getPlatformLineup,
  lineupPage,
  platform,
  platformPlan,
  setLineupReviewStatus,
  setTenantOperator,
  tenant,
  upsertLineupDraft,
  type Database,
  type LineupPageContent,
} from '@galaxie/db';
import { loadWtwConfig, syncBroadcasterLibrary } from '@galaxie/where-to-watch';
import { confirmFromPages } from '../src/lineups/confirm.js';
import { CURATION_NOTE, curateLineup, parseCuration } from '../src/lineups/curate.js';
import { dbPageStore, OfficialPageReader, type PageRenderer } from '../src/lineups/pages.js';
import { readRenderedPage } from '../src/testing/lineup-gabarito.js';
import { disposableDb } from './helpers.js';

const config = loadWtwConfig({ env: {} });
const NOW = new Date('2026-10-24T18:00:00Z');
const SITE = 'https://plataforma-a.exemplo';
const PAGE = `${SITE}/home/planos`;
const fixture = readRenderedPage();

/** O site só mostra a grade com JavaScript: o HTML estático é a casca; o navegador (falso) devolve a fixture. */
function readerWith(content: () => LineupPageContent, db: Database) {
  const renders: string[] = [];
  const renderer: PageRenderer = {
    render: async (url) => {
      renders.push(url);
      return { finalUrl: url, status: 200, ...content(), blocked: false };
    },
    close: async () => undefined,
  };
  const reader = new OfficialPageReader({
    fetch: async (url) =>
      url === PAGE || url === `${SITE}/`
        ? new Response('<html><body><div id="app">Carregando</div></body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        : new Response('', { status: 404 }),
    renderer,
    store: dbPageStore(db),
    now: () => NOW,
    sleep: async () => undefined,
  });
  return { reader, renders };
}

const env = disposableDb();
let db: Database;
let platformId: string;

beforeAll(async () => {
  db = await env.setup();
  await syncBroadcasterLibrary(db, config, NOW);
  // o que a pesquisa deixou: 3 dos 4 planos (o Plano TV ficou de fora) e a ESPN da página geral, sem prova
  const r = await upsertLineupDraft(db, {
    platform: { name: 'Plataforma A', kind: 'vmvpd', country: 'BR', website: SITE, sources: [PAGE] },
    plans: ['Plano Futebol', 'Plano Streaming', 'Plano Futebol Total'].map((name) => ({
      name,
      sources: [PAGE],
      channels: [{ channelId: 'espn', access: 'unverified' as const, sources: [PAGE] }],
    })),
    seenAt: NOW,
  });
  platformId = r.platformId;
  await setLineupReviewStatus(
    db,
    { type: 'plan', id: r.planIds['plano-futebol-total']! },
    'approved',
    'wagner',
  );
});
afterAll(() => env.teardown());

describe('lineups-pages: a página oficial confirma a grade', () => {
  it('lê pelo navegador, confirma cada plano, cria o que a IA perdeu e grava o catálogo de complementos', async () => {
    const { reader, renders } = readerWith(() => fixture, db);
    const [out] = await confirmFromPages({ db, config, reader, now: () => NOW }, { countries: ['BR'] });
    expect(renders).toEqual([PAGE]);
    expect(out!.pages).toMatchObject([{ url: PAGE, status: 'ok', via: 'render' }]);
    expect(out!.plans.find((p) => p.name === 'Plano TV')).toMatchObject({
      created: true,
      gradeFrom: 'section',
    });

    const lineup = (await getPlatformLineup(db, platformId, {
      minReview: 'draft',
      includeUnverified: true,
    }))!;
    const byName = new Map(lineup.plans.map((p) => [p.plan.name, p]));
    expect([...byName.keys()].sort()).toEqual([
      'Plano Futebol',
      'Plano Futebol Total',
      'Plano Streaming',
      'Plano TV',
    ]);

    const futebol = byName.get('Plano Futebol')!;
    expect([futebol.plan.priceAmount, futebol.plan.priceCurrency, futebol.plan.priceText]).toEqual([
      149.9,
      'BRL',
      'R$ 149,90/mês',
    ]);
    expect(futebol.plan.verification).toMatchObject({
      tier: 'official',
      verified: true,
      checks: { page: 'pass' },
      page: { url: PAGE, via: 'render' },
    });
    expect(futebol.plan.verification?.page?.hash).toHaveLength(64);
    const channels = futebol.channels.filter((c) => c.access === 'included').map((c) => c.channelId);
    expect(channels).toEqual(expect.arrayContaining(['globo', 'cazetv', 'ge_tv']));
    // a ESPN que a pesquisa tirou da página geral não está na lista do plano: fica como "não vista"
    const espn = futebol.channels.find((c) => c.channelId === 'espn')!;
    expect(espn.proposedChange).toMatchObject({ removed: true });
    expect(futebol.services.map((s) => s.serviceId).sort()).toEqual(
      ['disney_plus', 'nfl_game_pass', 'paramount_plus', 'premiere', 'prime_video', 'sportynet'].sort(),
    );

    const tv = byName.get('Plano TV')!;
    expect(tv.plan.priceAmount).toBe(99.9);
    expect(tv.channels.map((c) => c.channelId)).toEqual(
      expect.arrayContaining(['espn', 'sportv', 'ge_tv', 'cazetv']),
    );
    expect(tv.services.map((s) => s.serviceId).sort()).toEqual(['nfl_game_pass', 'prime_video']);

    // complementos: Premiere mensal e com fidelidade; ESPN 6 só como canal à parte
    expect(
      lineup.addons.map((a) => [a.refId, a.kind, a.channel, a.priceAmount, a.commitmentMonths]).sort(),
    ).toEqual(
      [
        ['disney_plus', 'service', null, 49.9, null],
        ['espn', 'channel', 'ESPN 6', 4.9, 12],
        ['hbo_max', 'service', null, 44.9, null],
        ['paramount_plus', 'service', null, 34.9, null],
        ['premiere', 'service', null, 59.9, null],
        ['premiere', 'service', null, 49.9, 12],
        ['sportynet', 'service', null, 29.9, null],
        ['telecine', 'service', null, 29.9, null],
      ].sort(),
    );
    expect(out!.unknownAddons).toEqual([]);

    // proveniência no cache: URL, data e hash
    const [page] = await db.select().from(lineupPage).where(eq(lineupPage.url, PAGE));
    expect(page).toMatchObject({ status: 'ok', via: 'render', platformId });
    expect(page!.contentHash).toBe(futebol.plan.verification?.page?.hash);
  });

  it('onde assistir: quem não tem o Premiere no plano vê o complemento "a partir de"', async () => {
    const rows = await availabilityForChannels(db, {
      channelIds: ['premiere'],
      country: 'BR',
      minReview: 'draft',
    });
    const mine = rows.find((r) => r.platform.id === platformId)!;
    expect(mine.plans.map((p) => p.plan.name).sort()).toEqual(['Plano Futebol', 'Plano Futebol Total']);
    expect(mine.addons.map((a) => a.priceAmount).sort()).toEqual([49.9, 59.9]);
  });

  it('onde assistir: o complemento de canal só aparece no jogo daquele canal, não colapsa na ESPN', async () => {
    const espnOn = async (channel: string | null) =>
      (
        await availabilityForChannels(db, {
          channelIds: ['espn'],
          channelNames: { espn: [channel] },
          country: 'BR',
          minReview: 'draft',
        })
      ).find((r) => r.platform.id === platformId)!;
    // jogo na ESPN 4: o plano com a ESPN leva, e não há "ESPN 6 como complemento"
    const espn4 = await espnOn('ESPN 4');
    expect(espn4.plans.map((p) => p.plan.name)).toContain('Plano TV');
    expect(espn4.addons).toEqual([]);
    // jogo na ESPN 6: o complemento do canal aparece, com o preço com fidelidade
    const espn6 = await espnOn('ESPN 6');
    expect(espn6.addons.map((a) => [a.channel, a.priceAmount, a.commitmentMonths])).toEqual([
      ['ESPN 6', 4.9, 12],
    ]);
    // canal do jogo desconhecido: nada de complemento de canal
    expect((await espnOn(null)).addons).toEqual([]);
  });

  it('dentro da validade não busca de novo; a página que mudou vira mudança no plano revisado', async () => {
    const first = readerWith(() => fixture, db);
    await confirmFromPages({ db, config, reader: first.reader, now: () => NOW }, { countries: ['BR'] });
    expect(first.renders).toEqual([]);

    const changed = {
      ...fixture,
      text: fixture.text.replace('R$ 219,90', 'R$ 229,90'),
    };
    const second = readerWith(() => changed, db);
    const [out] = await confirmFromPages(
      { db, config, reader: second.reader, now: () => NOW },
      { countries: ['BR'], force: true },
    );
    expect(out!.pages[0]).toMatchObject({ hashChanged: true });
    const [total] = await db
      .select()
      .from(platformPlan)
      .where(and(eq(platformPlan.platformId, platformId), eq(platformPlan.slug, 'plano-futebol-total')));
    // aprovado: não volta a rascunho; o preço novo e a página mudada ficam para revisar
    expect(total).toMatchObject({ reviewStatus: 'approved' });
    expect(total!.proposedChange).toMatchObject({
      priceAmount: 229.9,
      note: 'a página oficial do plano mudou',
    });
    // a leitura nova da mesma página substitui a anterior (mudança, não conflito entre fontes)
    expect(total!.verification?.prices?.map((p) => [p.amount, p.origin])).toEqual([[229.9, 'page']]);
  });
});

describe('lineups-curate: curadoria interna com prévia', () => {
  it('prévia não grava; aplicar aprova a grade completa, liga os tenants e aposenta a plataforma antiga', async () => {
    const old = await upsertLineupDraft(db, {
      platform: {
        name: 'Marca Antiga',
        kind: 'vmvpd',
        country: 'BR',
        website: 'https://marca-antiga.exemplo',
        sources: ['https://marca-antiga.exemplo'],
      },
      seenAt: NOW,
    });
    const [t] = await db
      .insert(tenant)
      .values({
        slug: 'operadora-cliente',
        name: 'Operadora Cliente',
        plan: 'fan_experience',
        modules: ['core_data'],
      })
      .returning({ id: tenant.id });
    await setTenantOperator(db, t!.id, { platformId: old.platformId });

    const input = parseCuration({
      country: 'BR',
      platform: {
        slug: 'br-marca-nova',
        name: 'Marca Nova',
        kind: 'vmvpd',
        website: 'https://marca-nova.exemplo',
      },
      replaces: ['br-marca-antiga'],
      plans: [
        {
          name: 'Plano Futebol',
          price_amount: 149.9,
          channels: ['Globo', 'CazéTV', 'GE TV', 'Canal Inexistente'],
          services: ['Amazon Prime', 'Premiere'],
        },
      ],
      addons: [{ name: 'Premiere Fidelidade', kind: 'service', price_amount: 49.9, commitment_months: 12 }],
    });
    const preview = await curateLineup(db, config, input, { apply: false, now: NOW });
    expect(preview).toMatchObject({
      applied: false,
      platform: { slug: 'br-marca-nova', exists: false },
      unknown: ['Canal Inexistente'],
      replaces: [{ slug: 'br-marca-antiga', found: true, tenants: [t!.id] }],
    });
    expect(await db.select().from(platform).where(eq(platform.slug, 'br-marca-nova'))).toEqual([]);

    const applied = await curateLineup(db, config, input, { apply: true, now: NOW });
    expect(applied.applied).toBe(true);
    const [nova] = await db.select().from(platform).where(eq(platform.slug, 'br-marca-nova'));
    const lineup = (await getPlatformLineup(db, nova!.id))!; // padrão: só o aprovado
    expect(lineup.platform.reviewStatus).toBe('approved');
    expect(lineup.plans.map((p) => [p.plan.name, p.plan.priceText, p.plan.reviewStatus])).toEqual([
      ['Plano Futebol', 'R$ 149,90/mês', 'approved'],
    ]);
    expect(lineup.plans[0]!.channels.map((c) => c.channelId).sort()).toEqual(['cazetv', 'ge_tv', 'globo']);
    expect(lineup.plans[0]!.plan.sources).toMatchObject([
      { url: null, kind: 'operator', note: CURATION_NOTE },
    ]);
    expect(lineup.addons.map((a) => [a.refId, a.priceAmount, a.commitmentMonths])).toEqual([
      ['premiere', 49.9, 12],
    ]);
    // o tenant passou para a plataforma nova; a antiga saiu da API
    const [moved] = await db.select().from(tenant).where(eq(tenant.id, t!.id));
    expect(moved!.operatorPlatformId).toBe(nova!.id);
    const [antiga] = await db.select().from(platform).where(eq(platform.id, old.platformId));
    expect(antiga!.reviewStatus).toBe('rejected');
  });

  it('confirmação pela página: o preço em US$ do cartão é gravado em USD, não na moeda do país', async () => {
    const dollar = { ...fixture, text: fixture.text.replaceAll('R$ 149,90', 'US$ 149,90') };
    const { reader } = readerWith(() => dollar, db);
    const later = new Date(NOW.getTime() + 86_400_000);
    await confirmFromPages(
      { db, config, reader, now: () => later },
      { countries: ['BR'], platformSlug: 'br-plataforma-a', force: true },
    );
    const lineup = (await getPlatformLineup(db, platformId, {
      minReview: 'draft',
      includeUnverified: true,
    }))!;
    const futebol = lineup.plans.find((p) => p.plan.name === 'Plano Futebol')!;
    expect([futebol.plan.priceAmount, futebol.plan.priceCurrency, futebol.plan.priceText]).toEqual([
      149.9,
      'USD',
      'US$ 149,90/mês',
    ]);
    // o resto da página segue em reais
    expect(lineup.plans.find((p) => p.plan.name === 'Plano TV')!.plan.priceCurrency).toBe('BRL');
  });
});

describe('lineups-pages: valor inválido na página sinaliza, não derruba o job', () => {
  it('plano com "R$ 0" entra sem preço, com o valor lido e o motivo; os outros planos seguem', async () => {
    const free = { ...fixture, text: fixture.text.replaceAll('R$ 149,90', 'R$ 0') };
    const { reader } = readerWith(() => free, db);
    const later = new Date(NOW.getTime() + 2 * 86_400_000);
    const [out] = await confirmFromPages(
      { db, config, reader, now: () => later },
      { countries: ['BR'], platformSlug: 'br-plataforma-a', force: true },
    );
    expect(out!.error).toBeUndefined();
    expect(out!.flagged).toEqual([
      { item: 'Plano Futebol', flag: { field: 'price_amount', value: '0', reason: 'Preço inválido: 0' } },
    ]);
    const lineup = (await getPlatformLineup(db, platformId, {
      minReview: 'draft',
      includeUnverified: true,
    }))!;
    const futebol = lineup.plans.find((p) => p.plan.name === 'Plano Futebol')!;
    expect([futebol.plan.priceAmount, futebol.plan.priceCurrency, futebol.plan.priceText]).toEqual([
      null,
      null,
      null,
    ]);
    expect(futebol.plan.verification).toMatchObject({
      flags: [{ field: 'price_amount', value: '0' }],
      page: { url: PAGE },
    });
    // o valor lido fica entre os preços vistos, com a fonte
    expect(futebol.plan.verification?.prices).toContainEqual(
      expect.objectContaining({ amount: 0, origin: 'page' }),
    );
    // a grade do plano foi gravada mesmo assim
    expect(futebol.channels.filter((c) => c.access === 'included').map((c) => c.channelId)).toEqual(
      expect.arrayContaining(['globo', 'cazetv']),
    );
    expect(lineup.plans.find((p) => p.plan.name === 'Plano TV')!.plan.priceAmount).toBe(99.9);

    // a página corrigida tira a sinalização
    const fixed = readerWith(() => fixture, db);
    const [again] = await confirmFromPages(
      { db, config, reader: fixed.reader, now: () => new Date(later.getTime() + 60_000) },
      { countries: ['BR'], platformSlug: 'br-plataforma-a', force: true },
    );
    expect(again!.flagged).toEqual([]);
    const [row] = await db
      .select()
      .from(platformPlan)
      .where(and(eq(platformPlan.platformId, platformId), eq(platformPlan.slug, 'plano-futebol')));
    expect(row).toMatchObject({ priceAmount: 149.9, priceCurrency: 'BRL' });
    expect(row!.verification?.flags).toBeUndefined();
  });

  it('erro numa plataforma fica no resultado dela e a leitura segue nas outras', async () => {
    const BROKEN = 'https://plataforma-0.exemplo/planos';
    await upsertLineupDraft(db, {
      platform: {
        name: 'Plataforma 0',
        kind: 'vmvpd',
        country: 'BR',
        website: 'https://plataforma-0.exemplo',
        sources: [BROKEN],
      },
      plans: [{ name: 'Plano Único', url: BROKEN, sources: [BROKEN] }],
      seenAt: NOW,
    });
    const { reader } = readerWith(() => fixture, db);
    const read = reader.read.bind(reader);
    reader.read = async (url, ...rest) => {
      if (url === BROKEN) throw new Error('falha inesperada na leitura');
      return read(url, ...rest);
    };
    const logs: string[] = [];
    const outs = await confirmFromPages(
      { db, config, reader, now: () => NOW, log: (m) => logs.push(m) },
      { countries: ['BR'] },
    );
    const bySlug = new Map(outs.map((o) => [o.slug, o]));
    expect(bySlug.get('br-plataforma-0')).toMatchObject({ error: 'falha inesperada na leitura', plans: [] });
    expect(bySlug.get('br-plataforma-a')!.error).toBeUndefined();
    expect(bySlug.get('br-plataforma-a')!.plans.length).toBeGreaterThan(0);
    expect(logs).toContain('br-plataforma-0: erro — falha inesperada na leitura');
  });
});
