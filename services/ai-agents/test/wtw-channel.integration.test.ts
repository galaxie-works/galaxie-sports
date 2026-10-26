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
import { channelScheduleFromEnv } from '../src/wtw/channel/windows.js';
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
// padrão: consulta semanal segunda 06:00 UTC, retentativas 3d e 1d, pós-jogo ligado
const schedule = channelScheduleFromEnv({});
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

  it('retentativa de 3 dias: importa a opção salva, pesquisa o resto e grava só o que o validador aceita', async () => {
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
    const plan = await planChannelResearch(db, {
      now,
      markets: ['BR', 'MX'],
      config,
      researched,
      policy,
      schedule,
    });
    // a consulta semanal de segunda (02/11) cobriu a rodada; a de 3 dias abriu em 04/11 19:00
    expect(plan.groups.map((g) => [g.window.window, g.targets.length])).toEqual([['retry-3d', 6]]);

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
    const fetcher = new FakePageFetcher({ ...PAGES });
    const runner = new MatchChannelRunner({ db, llm, config, policy, fetcher, now: () => now });
    const report = await runner.run(plan.groups, { maxCalls: 2 });
    expect(report.groups[0]).toMatchObject({ status: 'researched', calls: 1 });
    // URL que não veio da busca do provedor nem é buscada (SSRF por URL do modelo)
    expect(fetcher.requested).not.toContain('https://emissora-m.example/inventada');
    expect(fetcher.requested).toContain(ESCALA);
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
        window: 'retry-3d',
        phase: 'pre',
      },
    ]);
    expect(j1[0]!.sourceUrl).toBe(ESCALA);
    expect(await currentMatchChannels(db, ids[1]!, 'BR')).toEqual([]);
    expect(await currentMatchChannels(db, ids[0]!, 'MX')).toEqual([]);
    expect(await currentMatchChannels(db, ids[2]!, 'BR')).toMatchObject([
      { broadcasterId: 'streaming_b', window: 'import', researchId: null },
    ]);
    const rows = await db.select().from(wtwResearch).where(eq(wtwResearch.kind, 'channel'));
    // o jogo resolvido pela importação fica registrado à parte (sem custo)
    expect(rows.find((r) => r.researchKey.endsWith(':import'))).toMatchObject({
      markets: ['BR'],
      costUsd: null,
      stats: expect.objectContaining({ targets: [`${ids[2]}:BR`] }),
    });
    const research = rows.find((r) => !r.researchKey.endsWith(':import'));
    expect(research).toMatchObject({ status: 'done', costUsd: '0.100000', markets: ['BR', 'MX'] });

    // o mesmo momento não pesquisa de novo
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

  it('depois do jogo: só os encerrados sem canal confirmado voltam à pesquisa', async () => {
    // canal só da imprensa, gravado antes do jogo: com canal confirmado, o jogo não volta à pesquisa
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
      window: 'retry-1d',
      researchId: null,
      now: new Date(KICKOFF.getTime() - 5 * H),
    });
    for (const id of ids) await db.update(event).set({ status: 'finished' }).where(eq(event.id, id));
    const now = new Date(KICKOFF.getTime() + 8 * H);
    const researched = new ResearchedRightsIndex(await currentResearchedRights(db));
    const plan = await planChannelResearch(db, {
      now,
      markets: ['BR'],
      config,
      researched,
      policy,
      schedule,
    });
    expect(plan.groups.map((g) => [g.window.window, g.window.phase])).toEqual([['post', 'post']]);
    // 1º jogo (canal da escala) e 3º (importado) já têm canal: só o 2º entra
    expect(plan.groups[0]!.targets.map((t) => t.event.id)).toEqual([ids[1]]);
    expect(plan.skipped.already_confirmed).toBe(2);

    const POS = 'https://emissora-a.example/transmissoes';
    const llm = new FakeLlmClient(() => ({
      data: {
        assignments: [
          row('J1', 'BR', 'emissora_a', POS, 'Gama SC x Delta FC foi transmitido pela Emissora A'),
        ],
        notes: null,
      },
      usage: { inputTokens: 30_000, outputTokens: 2_000, webSearchCalls: 4, costUsd: 0.1 },
      groundedUrls: [POS],
    }));
    const runner = new MatchChannelRunner({
      db,
      llm,
      config,
      policy,
      fetcher: new FakePageFetcher({
        ...PAGES,
        [POS]: '<p>Gama SC x Delta FC foi transmitido pela Emissora A.</p>',
      }),
      now: () => now,
    });
    const report = await runner.run(plan.groups, { maxCalls: 2, importSaved: false });
    expect(report.applied).toMatchObject({ inserted: 1 });
    expect(llm.calls[0]!.purpose).toBe('wtw:channel:liga-dividida:Regular_Season_-_32:post:BR');

    expect(await currentMatchChannels(db, ids[1]!, 'BR')).toMatchObject([
      { broadcasterId: 'emissora_a', status: 'confirmed', phase: 'post', window: 'post' },
    ]);
    // o 1º jogo segue com os canais de antes (nenhuma pesquisa depois do jogo)
    const rows = await db
      .select()
      .from(matchChannel)
      .where(and(eq(matchChannel.eventId, ids[0]!), eq(matchChannel.countryCode, 'BR')));
    expect(rows.map((r) => [r.broadcasterId, r.status, r.postConfirmedAt]).sort()).toEqual([
      ['emissora_a', 'confirmed', null],
      ['streaming_b', 'confirmed', null],
    ]);
    // a gravação continua: fonte oficial depois do jogo tira o canal que só a imprensa sustentava
    const official = await applyMatchChannels(db, {
      eventId: ids[0]!,
      country: 'BR',
      accepted: [
        {
          broadcasterId: 'emissora_a',
          providerName: 'Emissora A',
          channel: null,
          confidence: 0.9,
          sourceKind: 'official',
          evidence: [
            {
              url: ESCALA,
              publisher: 'emissora-a.example',
              excerpt: 'Alfa FC x Beta EC na Emissora A',
              sourceKind: 'broadcaster',
              publishedAt: null,
              pageVerified: true,
              fetchedAt: new Date().toISOString(),
            },
          ],
        },
      ],
      phase: 'post',
      window: 'post',
      researchId: null,
      now,
    });
    expect(official).toMatchObject({ updated: 1, retracted: 1 });

    const done = (await getPublicWhereToWatch(db, { eventId: ids[1]!, country: 'BR' }, config))!;
    expect(done.matchChannel).toMatchObject({ phase: 'post', state: 'confirmed' });
    expect(done.matchChannel.channels.map((c) => [c.option.row.providerName, c.postMatch])).toEqual([
      ['Emissora A', true],
    ]);
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
      { country: 'BR', competition: null, total: 3, withOption: 0, withMatchChannel: 3 },
    ]);
  });
});

/** Outra rodada da mesma competição (`games` jogos a partir de `startsAt`, a cada 2 h). */
async function seedMoreRounds(label: string, startsAt: Date, games: number): Promise<string[]> {
  const [comp] = await db.select().from(competition).where(eq(competition.slug, 'liga-dividida'));
  const [ssn] = await db.select().from(season).where(eq(season.competitionId, comp!.id));
  const [stg] = await db
    .insert(stage)
    .values({ seasonId: ssn!.id, kind: 'regular', name: { 'pt-BR': 'Rodada' }, providerLabel: label })
    .returning();
  const ids: string[] = [];
  for (let i = 0; i < games; i++) {
    const [h, a] = TEAMS[i % TEAMS.length]!;
    const [home, away] = await db
      .insert(participant)
      .values([
        { sport: 'football', kind: 'club', name: h },
        { sport: 'football', kind: 'club', name: a },
      ])
      .returning();
    const at = new Date(startsAt.getTime() + i * 2 * H);
    const [ev] = await db
      .insert(event)
      .values({
        sport: 'football',
        competitionId: comp!.id,
        seasonId: ssn!.id,
        stageId: stg!.id,
        startsAt: at,
        endsAtExpected: new Date(at.getTime() + 2 * H),
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

describe('canal do jogo: teto diário por mercado', () => {
  const silent = (cost: number) =>
    new FakeLlmClient(() => ({
      data: { assignments: [], notes: null },
      usage: { inputTokens: 30_000, outputTokens: 2_000, webSearchCalls: 4, costUsd: cost },
      groundedUrls: [],
    }));
  const groupsOf = async (now: Date, markets: string[], round: string) => {
    const researched = new ResearchedRightsIndex(await currentResearchedRights(db));
    const plan = await planChannelResearch(db, { now, markets, config, researched, policy, schedule });
    return plan.groups.filter((g) => g.key.includes(round));
  };

  it('vale a cada pedaço da rodada: o segundo pedaço não passa do teto', async () => {
    const startsAt = new Date(KICKOFF.getTime() + 10 * 24 * H);
    const now = new Date(startsAt.getTime() - 30 * H);
    await seedMoreRounds('Regular Season - 40', startsAt, 13);
    const groups = await groupsOf(now, ['BR'], 'Regular Season - 40');
    expect(groups.map((g) => g.targets.length)).toEqual([13]);
    const llm = silent(0.95);
    const runner = new MatchChannelRunner({
      db,
      llm,
      config,
      policy: { ...policy, dailyUsdPerMarket: 1 },
      fetcher: new FakePageFetcher({}),
      now: () => now,
    });
    const report = await runner.run(groups, { maxCalls: 3, importSaved: false });
    expect(llm.calls).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({ status: 'researched', calls: 1 });

    // na execução seguinte, com folga no teto, só o 13º jogo (o BR não fica "coberto" pelo 1º pedaço)
    const later = silent(0.1);
    const next = new MatchChannelRunner({
      db,
      llm: later,
      config,
      policy,
      fetcher: new FakePageFetcher({}),
      now: () => now,
    });
    const r2 = await next.run(groups, { maxCalls: 3, importSaved: false });
    expect(r2.groups[0]).toMatchObject({ status: 'researched', calls: 1 });
    const prompt = later.calls[0]!.messages[0]!.content;
    expect(prompt).toMatch(/J1:/);
    expect(prompt).not.toMatch(/J2:/);
    expect((await next.run(groups, { maxCalls: 3, importSaved: false })).groups[0]!.status).toBe(
      'already_researched',
    );
    expect(later.calls).toHaveLength(1);
  });

  it('pesquisa antiga (chave com os mercados, sem stats.targets) cobre os jogos dos mercados dela', async () => {
    const startsAt = new Date(KICKOFF.getTime() + 30 * 24 * H);
    const now = new Date(startsAt.getTime() - 30 * H);
    await seedMoreRounds('Regular Season - 60', startsAt, 2);
    const groups = await groupsOf(now, ['BR', 'MX'], 'Regular Season - 60');
    const g = groups[0]!;
    await db.insert(wtwResearch).values({
      kind: 'channel',
      researchKey: `channel:${g.key}:${g.season}:BR:0`,
      competitionSlug: 'liga-dividida',
      markets: ['BR'],
      status: 'done',
      createdAt: now,
    });
    const llm = silent(0.1);
    const runner = new MatchChannelRunner({
      db,
      llm,
      config,
      policy,
      fetcher: new FakePageFetcher({}),
      now: () => now,
    });
    const r = await runner.run(groups, { maxCalls: 3, importSaved: false });
    expect(r.groups[0]).toMatchObject({ status: 'researched', calls: 1 });
    // só o MX vai para a pesquisa: o BR já estava coberto pela chave antiga
    expect(llm.calls[0]!.messages[0]!.content).not.toMatch(/- BR \(Brasil\)/);
    expect(llm.calls[0]!.messages[0]!.content).toMatch(/- MX \(México\)/);
  });

  it('mercado cortado pelo teto não fica marcado como pesquisado: entra na rodada seguinte', async () => {
    const startsAt = new Date(KICKOFF.getTime() + 20 * 24 * H);
    const now = new Date(startsAt.getTime() - 30 * H);
    await seedMoreRounds('Regular Season - 50', startsAt, 2);
    // o MX já gastou quase o teto do dia
    await db.insert(wtwResearch).values({
      kind: 'allocation',
      researchKey: 'teste:gasto-mx',
      competitionSlug: 'outra',
      markets: ['MX'],
      status: 'done',
      costUsd: '0.950000',
      createdAt: now,
    });
    const groups = await groupsOf(now, ['BR', 'MX'], 'Regular Season - 50');
    const capped = silent(0.1);
    const first = new MatchChannelRunner({
      db,
      llm: capped,
      config,
      policy: { ...policy, dailyUsdPerMarket: 1 },
      fetcher: new FakePageFetcher({}),
      now: () => now,
    });
    const r1 = await first.run(groups, { maxCalls: 3, importSaved: false });
    expect(r1.groups[0]).toMatchObject({ status: 'researched', calls: 1 });
    expect(capped.calls[0]!.messages[0]!.content).not.toMatch(/- MX \(México\)/);

    // com folga no teto, o MX é pesquisado; o BR, já feito, não volta
    const later = silent(0.1);
    const second = new MatchChannelRunner({
      db,
      llm: later,
      config,
      policy,
      fetcher: new FakePageFetcher({}),
      now: () => now,
    });
    const r2 = await second.run(groups, { maxCalls: 3, importSaved: false });
    expect(r2.groups[0]).toMatchObject({ status: 'researched', calls: 1 });
    expect(later.calls[0]!.messages[0]!.content).toMatch(/- MX \(México\)/);
    expect(later.calls[0]!.messages[0]!.content).not.toMatch(/- BR \(Brasil\)/);
    const third = await second.run(groups, { maxCalls: 3, importSaved: false });
    expect(third.groups[0]!.status).toBe('already_researched');
  });
});
