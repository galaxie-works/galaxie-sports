import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  broadcastOption,
  closeDb,
  competition,
  country,
  createDb,
  event,
  eventParticipant,
  matchChannel,
  participant,
  runMigrations,
  season,
  sport,
  stage,
  wtwResearch,
  type Database,
} from '@galaxie/db';
import {
  applyMatchChannels,
  Blocklist,
  currentMatchChannels,
  currentResearchedRights,
  getPublicWhereToWatch,
  parseCountryConfig,
  ResearchedRightsIndex,
  WtwConfig,
} from '@galaxie/where-to-watch';
import { FakeLlmClient } from '../src/llm/fake.js';
import type { LlmJsonRequest } from '../src/llm/types.js';
import { channelBaseline } from '../src/wtw/channel/baseline.js';
import { planChannelResearch } from '../src/wtw/channel/plan.js';
import { MatchChannelRunner } from '../src/wtw/channel/runner.js';
import type { ChannelAssignmentOutput } from '../src/wtw/channel/schema.js';
import { FakePageFetcher } from '../src/wtw/fetcher.js';
import type { WtwPolicy } from '../src/wtw/relevance.js';

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
const H = 3_600_000;
const KICKOFF = new Date('2026-11-07T19:00:00Z');

const sources = {
  organizers: ['organizador.example'],
  press: ['imprensa.example'],
  aggregators: ['guia.example'],
};
const rightsSource = 'https://organizador.example/direitos';
const split = (holders: string[]) => ({
  competition: 'liga-dividida',
  season: 2026,
  valid_from: '2026-01-01',
  valid_to: '2026-12-31',
  distribution: 'split',
  holders,
  sources: [rightsSource],
});
const br = parseCountryConfig(
  'BR',
  {
    country: 'BR',
    language: 'pt-BR',
    broadcasters: [
      {
        id: 'emissora_a',
        name: 'Emissora A',
        medium: 'free_tv',
        access_model: 'free',
        domains: ['emissora-a.example'],
      },
      {
        id: 'streaming_b',
        name: 'Streaming B',
        medium: 'streaming_svod',
        access_model: 'subscription',
        domains: ['streaming-b.example'],
      },
    ],
  },
  { country: 'BR', rights: [split(['emissora_a', 'streaming_b'])] },
  sources,
);
const mx = parseCountryConfig(
  'MX',
  {
    country: 'MX',
    broadcasters: [
      {
        id: 'emissora_m',
        name: 'Emissora M',
        medium: 'free_tv',
        access_model: 'free',
        domains: ['emissora-m.example'],
      },
      {
        id: 'streaming_n',
        name: 'Streaming N',
        medium: 'streaming_svod',
        access_model: 'subscription',
        domains: ['streaming-n.example'],
      },
    ],
  },
  { country: 'MX', rights: [split(['emissora_m', 'streaming_n'])] },
  sources,
);
const config = new WtwConfig([br, mx], new Blocklist([]));
const policy: WtwPolicy = { minRelevance: 60, dailyUsdPerMarket: 5 };
const TEAMS = [
  ['Alfa FC', 'Beta EC'],
  ['Gama SC', 'Delta FC'],
  ['Epsilon', 'Zeta'],
] as const;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 4 });
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

async function seedRound(): Promise<string[]> {
  const [comp] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: 'liga-dividida',
      name: 'Liga Dividida',
      type: 'league',
      tier: 1,
      countryCode: null,
    })
    .returning();
  const [ssn] = await db
    .insert(season)
    .values({ competitionId: comp!.id, label: '2026', year: 2026 })
    .returning();
  const [stg] = await db
    .insert(stage)
    .values({
      seasonId: ssn!.id,
      kind: 'regular',
      name: { 'pt-BR': 'Rodada' },
      providerLabel: 'Regular Season - 32',
    })
    .returning();
  const ids: string[] = [];
  for (const [i, [h, a]] of TEAMS.entries()) {
    const [home, away] = await db
      .insert(participant)
      .values([
        { sport: 'football', kind: 'club', name: h },
        { sport: 'football', kind: 'club', name: a },
      ])
      .returning();
    const startsAt = new Date(KICKOFF.getTime() + i * 2 * H);
    const [ev] = await db
      .insert(event)
      .values({
        sport: 'football',
        competitionId: comp!.id,
        seasonId: ssn!.id,
        stageId: stg!.id,
        startsAt,
        endsAtExpected: new Date(startsAt.getTime() + 2 * H),
        importance: 70,
      })
      .returning();
    await db.insert(eventParticipant).values([
      { eventId: ev!.id, participantId: home!.id, side: 'home' },
      { eventId: ev!.id, participantId: away!.id, side: 'away' },
    ]);
    ids.push(ev!.id);
  }
  return ids;
}

const ESCALA = 'https://emissora-a.example/escala-rodada-32';
const IMPRENSA = 'https://imprensa.example/onde-assistir-rodada-32';
const AGENDA_B = 'https://streaming-b.example/agenda';
const PAGES: Record<string, string> = {
  [ESCALA]: '<p>Rodada 32: Alfa FC x Beta EC na Emissora A, sábado.</p>',
  [AGENDA_B]: '<p>Epsilon x Zeta ao vivo no Streaming B.</p>',
  [IMPRENSA]: 403,
} as never;

const row = (match: string, country: string, broadcaster: string, url: string, excerpt: string) =>
  ({
    match,
    country,
    broadcaster,
    channel: null,
    evidence: [{ url, excerpt, published_at: null }],
  }) satisfies ChannelAssignmentOutput;

describe('canal do jogo (wtw-channel) com o provedor falso', () => {
  let ids: string[] = [];
  const requests: LlmJsonRequest[] = [];
  const fakeFor = (reply: (req: LlmJsonRequest) => ChannelAssignmentOutput[]) =>
    new FakeLlmClient((req) => {
      requests.push(req);
      return {
        data: { assignments: reply(req), notes: null },
        usage: { inputTokens: 30_000, outputTokens: 2_000, webSearchCalls: 4, costUsd: 0.1 },
        groundedUrls: [ESCALA, IMPRENSA],
      };
    });

  it('T-48h: importa a opção salva, pesquisa o resto e grava só o que o validador aceita', async () => {
    ids = await seedRound();
    // opção salva pelo agente (alocação anterior) com fonte do jogo para o 3º jogo no BR
    await db.insert(broadcastOption).values({
      eventId: ids[2]!,
      countryCode: 'BR',
      providerName: 'Streaming B',
      broadcasterId: 'streaming_b',
      medium: 'streaming_svod',
      accessModel: 'subscription',
      status: 'pending',
      confidence: '0.60',
      evidence: [
        {
          url: AGENDA_B,
          excerpt: 'Epsilon x Zeta no Streaming B',
          fetchedAt: new Date().toISOString(),
          sourceKind: 'broadcaster',
        },
      ],
      producedBy: 'agent:wtw@v1',
    });
    const now = new Date(KICKOFF.getTime() - 30 * H);
    const researched = new ResearchedRightsIndex(await currentResearchedRights(db));
    const plan = await planChannelResearch(db, { now, markets: ['BR', 'MX'], config, researched, policy });
    expect(plan.groups.map((g) => [g.window.window, g.targets.length])).toEqual([['T-48h', 6]]);

    const llm = fakeFor(() => [
      row('J1', 'BR', 'emissora_a', ESCALA, 'Alfa FC x Beta EC, sábado, na Emissora A'),
      // imprensa sem página conferida (403): fica a confirmar
      row('J2', 'BR', 'streaming_b', IMPRENSA, 'Gama SC x Delta FC no Streaming B'),
      // URL fora do grounding: cai
      row(
        'J1',
        'MX',
        'emissora_m',
        'https://emissora-m.example/inventada',
        'Alfa FC x Beta EC por Emissora M',
      ),
    ]);
    const runner = new MatchChannelRunner({
      db,
      llm,
      config,
      policy,
      fetcher: new FakePageFetcher({ ...PAGES }),
      now: () => now,
    });
    const report = await runner.run(plan.groups, { maxCalls: 2 });
    expect(report.groups[0]).toMatchObject({ status: 'researched', calls: 1 });
    // o jogo importado no BR não volta para a pesquisa do BR
    const msg = requests[0]!.messages[0]!.content;
    expect(msg).toMatch(/- BR \(Brasil\) — jogos: J1, J2\n/);
    expect(msg).toMatch(/- MX \(México\) — jogos: J1, J2, J3\n/);

    const j1 = await currentMatchChannels(db, ids[0]!, 'BR');
    expect(j1).toMatchObject([
      {
        broadcasterId: 'emissora_a',
        status: 'confirmed',
        sourceKind: 'official',
        window: 'T-48h',
        phase: 'pre',
      },
    ]);
    expect(j1[0]!.sourceUrl).toBe(ESCALA);
    expect(await currentMatchChannels(db, ids[1]!, 'BR')).toEqual([]);
    expect(await currentMatchChannels(db, ids[0]!, 'MX')).toEqual([]);
    expect(await currentMatchChannels(db, ids[2]!, 'BR')).toMatchObject([
      { broadcasterId: 'streaming_b', window: 'import', researchId: null },
    ]);
    const [research] = await db.select().from(wtwResearch).where(eq(wtwResearch.kind, 'channel'));
    expect(research).toMatchObject({ status: 'done', costUsd: '0.100000', markets: ['BR', 'MX'] });

    // a mesma janela não pesquisa de novo
    const again = await runner.run(plan.groups, { maxCalls: 2 });
    expect(again.groups[0]!.status).toBe('already_researched');
    expect(requests).toHaveLength(1);
  });

  it('leitura pública: "passa em" antes, a confirmar sem canal; o canal vira opção publicada', async () => {
    const pub = (await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'BR' }, config))!;
    expect(pub.status).toBe('resolved');
    expect(pub.options.map((o) => [o.row.providerName, o.row.flags])).toEqual([
      ['Emissora A', ['match_channel']],
    ]);
    expect(pub.matchChannel).toMatchObject({ phase: 'pre', state: 'confirmed' });
    expect(pub.matchChannel.channels[0]!.source).toMatchObject({ kind: 'official', url: ESCALA });
    const none = (await getPublicWhereToWatch(db, { eventId: ids[1]!, country: 'BR' }, config))!;
    expect(none.matchChannel).toMatchObject({ phase: 'pre', state: 'to_confirm', channels: [] });
    expect(none.fromRights.map((r) => r.broadcasterId).sort()).toEqual(['emissora_a', 'streaming_b']);
  });

  it('depois do jogo: confirma quem transmitiu; fonte oficial tira o canal só da imprensa; sem canal = não confirmado', async () => {
    // canal só da imprensa, gravado antes, que a fonte oficial não repete
    await applyMatchChannels(db, {
      eventId: ids[0]!,
      country: 'BR',
      accepted: [
        {
          broadcasterId: 'streaming_b',
          providerName: 'Streaming B',
          channel: null,
          confidence: 0.8,
          sourceKind: 'press',
          evidence: [
            {
              url: IMPRENSA,
              publisher: 'imprensa.example',
              excerpt: 'Alfa FC x Beta EC no Streaming B',
              sourceKind: 'press',
              publishedAt: null,
              pageVerified: true,
              fetchedAt: new Date().toISOString(),
            },
          ],
        },
      ],
      phase: 'pre',
      window: 'T-6h',
      researchId: null,
      now: new Date(KICKOFF.getTime() - 5 * H),
    });
    for (const id of ids) await db.update(event).set({ status: 'finished' }).where(eq(event.id, id));
    const now = new Date(KICKOFF.getTime() + 8 * H);
    const researched = new ResearchedRightsIndex(await currentResearchedRights(db));
    const plan = await planChannelResearch(db, { now, markets: ['BR'], config, researched, policy });
    expect(plan.groups.map((g) => [g.window.window, g.window.phase])).toEqual([['post', 'post']]);
    const llm = fakeFor(() => [
      row('J1', 'BR', 'emissora_a', ESCALA, 'Alfa FC x Beta EC foi transmitido pela Emissora A'),
    ]);
    const runner = new MatchChannelRunner({
      db,
      llm,
      config,
      policy,
      fetcher: new FakePageFetcher({ ...PAGES }),
      now: () => now,
    });
    const report = await runner.run(plan.groups, { maxCalls: 2, importSaved: false });
    expect(report.applied).toMatchObject({ updated: 1, retracted: 1 });

    const rows = await db
      .select()
      .from(matchChannel)
      .where(and(eq(matchChannel.eventId, ids[0]!), eq(matchChannel.countryCode, 'BR')));
    const byId = Object.fromEntries(rows.map((r) => [r.broadcasterId, r]));
    expect(byId.emissora_a).toMatchObject({ status: 'confirmed', phase: 'post', window: 'post' });
    expect(byId.emissora_a!.postConfirmedAt).not.toBeNull();
    expect(byId.streaming_b).toMatchObject({ status: 'retracted' });

    const done = (await getPublicWhereToWatch(db, { eventId: ids[0]!, country: 'BR' }, config))!;
    expect(done.matchChannel).toMatchObject({ phase: 'post', state: 'confirmed' });
    expect(done.matchChannel.channels.map((c) => [c.option.row.providerName, c.postMatch])).toEqual([
      ['Emissora A', true],
    ]);
    const never = (await getPublicWhereToWatch(db, { eventId: ids[1]!, country: 'BR' }, config))!;
    expect(never.matchChannel).toMatchObject({ phase: 'post', state: 'not_confirmed', channels: [] });
  });

  it('linha de base: encerrados com opção gravada × com canal do jogo', async () => {
    await db
      .insert(country)
      .values({ code: 'BR', name: { 'pt-BR': 'Brasil' } })
      .onConflictDoNothing();
    await db.update(competition).set({ countryCode: 'BR' }).where(eq(competition.slug, 'liga-dividida'));
    const rows = await channelBaseline(db, {
      now: new Date(KICKOFF.getTime() + 24 * H),
      days: 7,
      markets: ['BR'],
    });
    expect(rows).toEqual([
      { country: 'BR', competition: null, total: 3, withOption: 0, withMatchChannel: 2 },
    ]);
  });
});
