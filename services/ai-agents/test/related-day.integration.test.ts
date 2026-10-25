/**
 * Simulação do dia de cota 2026-10-24 (docs/12 §8.3), com banco descartável e YouTube falso: os 142 jogos de
 * futebol tier ≤ 2 da produção entre a sexta à noite e a madrugada de domingo (consulta só de leitura, fixture
 * `fixtures/related-day-2026-10-24.json`), o cron rodando de 15 em 15 min das 07:00 UTC (a cota zera) até as
 * 07:00 do dia seguinte, e o mesmo "mundo" de vídeos para as duas regras:
 * - antes: só busca, 4 por execução, sem reserva, sem peso de mercado, sem rendimento (regras até a 0039);
 * - depois: canais conhecidos primeiro (P2397 do Wikidata + config), busca só como complemento, parada cedo,
 *   reserva por agenda, peso do mercado e rendimento histórico da competição.
 *
 * O mundo é um modelo (premissas no `world`): canal de clube posta coletiva e bastidores depois do jogo; o canal
 * da liga posta o resumo de todos os jogos; a emissora detentora posta melhores momentos e um short em metade dos
 * jogos; a busca devolve o que existe no YouTube naquela hora (vídeos dos canais, reações de criadores na mesma
 * quantidade de vídeos que a produção publicou e lixo que não cita os dois times).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { country, relatedChannel, type Database } from '@galaxie/db';
import { loadWtwConfig, type WtwConfig } from '@galaxie/where-to-watch';
import type { CompetitionYieldRow } from '../src/related/budget.js';
import { channelEntriesFromDb } from '../src/related/channel-map.js';
import {
  broadcasterChannelsFrom,
  ChannelAllowlist,
  loadChannelEntries,
  rightsHoldersFor,
} from '../src/related/channels.js';
import { relatedPolicyFromEnv, type RelatedPolicy } from '../src/related/priority.js';
import { runRelatedAgent } from '../src/related/run.js';
import { YoutubeClient, type FetchLike } from '../src/related/youtube.js';
import { disposableDb, idOf, ingest, seedCatalog, syntheticFixture } from './helpers.js';

interface FixtureGame {
  slug: string;
  competitionCountry: string;
  competitionName: string;
  tier: number;
  kickoff: string;
  importance: number;
  goals: [number, number] | null;
  home: string;
  homeCountry: string;
  homeQid: string | null;
  away: string;
  awayCountry: string;
  awayQid: string | null;
  real: { hits: Record<string, number> | null; searches: number; units: number; published: number };
}
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/related-day-2026-10-24.json', import.meta.url), 'utf8'),
) as {
  competitionQids: Record<string, string>;
  wikidataChannels: Record<string, string[]>;
  games: FixtureGame[];
};

/** Rendimento real por competição (produção, related_run × related_content, 10–24/10/2026). */
const HISTORY: Omit<CompetitionYieldRow, 'competitionId' | 'channelVideos'>[] = [
  { slug: 'colombia-primera-a', games: 3, searches: 24, apiUnits: 310, searchVideos: 0 },
  { slug: 'liga-mx', games: 3, searches: 20, apiUnits: 63, searchVideos: 5 },
  { slug: 'argentina-liga-profesional', games: 3, searches: 16, apiUnits: 70, searchVideos: 2 },
  { slug: 'peru-liga-1', games: 2, searches: 9, apiUnits: 130, searchVideos: 0 },
  { slug: 'brasileirao-serie-b', games: 2, searches: 8, apiUnits: 4, searchVideos: 5 },
  { slug: 'uruguay-primera', games: 1, searches: 5, apiUnits: 26, searchVideos: 0 },
  { slug: 'ligue-1', games: 1, searches: 4, apiUnits: 2, searchVideos: 0 },
  { slug: 'brasileirao-serie-a', games: 1, searches: 4, apiUnits: 31, searchVideos: 8 },
  { slug: 'serie-a-italia', games: 1, searches: 4, apiUnits: 2, searchVideos: 0 },
  { slug: 'laliga', games: 1, searches: 4, apiUnits: 2, searchVideos: 0 },
  { slug: 'chile-primera-division', games: 1, searches: 4, apiUnits: 0, searchVideos: 0 },
  { slug: 'liga-mx-femenil', games: 2, searches: 4, apiUnits: 0, searchVideos: 0 },
  { slug: 'premier-league', games: 1, searches: 3, apiUnits: 2, searchVideos: 1 },
  { slug: 'ecuador-ligapro-serie-a', games: 1, searches: 3, apiUnits: 22, searchVideos: 0 },
  { slug: 'bundesliga', games: 1, searches: 2, apiUnits: 2, searchVideos: 0 },
];

const START = new Date('2026-10-24T07:00:15Z');
const END = new Date('2026-10-25T07:00:00Z');
const STEP_MS = 15 * 60_000;
/** O jogo vira `finished` 115 min depois do início. */
const FINISH_MS = 115 * 60_000;
const MIN = 60_000;

const env = disposableDb();
let db: Database;
let wtw: WtwConfig;
const eventIds: string[] = [];

// ── mundo do YouTube ─────────────────────────────────────────────────────────────────────────────

interface WorldVideo {
  id: string;
  channelId: string;
  title: string;
  description: string;
  publishedAt: Date;
  duration: string;
  vertical: boolean;
  game: number;
}
interface WorldChannel {
  id: string;
  title: string;
  subscribers: number;
  country: string | null;
}

const hash = (s: string) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16);
const lang = (g: FixtureGame) =>
  g.homeCountry === 'BR' || g.awayCountry === 'BR'
    ? 'pt'
    : ['AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC', 'PY', 'BO', 'VE', 'ES'].includes(g.homeCountry)
      ? 'es'
      : 'en';
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

class World {
  now = START;
  readonly videos = new Map<string, WorldVideo>();
  readonly channels = new Map<string, WorldChannel>();
  readonly uploads = new Map<string, WorldVideo[]>();
  /** Reações de criador por jogo (achadas só pela busca). */
  readonly creator = new Map<number, WorldVideo[]>();
  readonly junk = new Map<number, WorldVideo[]>();
  searches = 0;

  channel(c: WorldChannel) {
    if (!this.channels.has(c.id)) this.channels.set(c.id, c);
  }

  post(v: Omit<WorldVideo, 'id' | 'description'> & { description?: string }) {
    const id = `v${this.videos.size + 1}`;
    const video = { ...v, id, description: v.description ?? 'Inscreva-se no canal!' };
    this.videos.set(id, video);
    const list = this.uploads.get(v.channelId) ?? [];
    list.push(video);
    this.uploads.set(v.channelId, list);
    return video;
  }

  visible = (v: WorldVideo) => v.publishedAt.getTime() <= this.now.getTime();

  fetch: FetchLike = async (url) => {
    const u = new URL(url);
    const p = u.searchParams;
    const json = (body: unknown) => new Response(JSON.stringify(body));
    const path = u.pathname.split('/').pop();
    if (path === 'search') {
      this.searches++;
      const q = norm(p.get('q') ?? '');
      const gi = FIXTURE.games.findIndex((g) => q.includes(norm(g.home)) && q.includes(norm(g.away)));
      const short = p.get('videoDuration') === 'short';
      const pool =
        gi < 0
          ? []
          : [
              // o que os canais conhecidos já postaram sobre o jogo aparece na busca
              ...[...this.videos.values()].filter(
                (v) =>
                  v.game === gi &&
                  this.visible(v) &&
                  !this.creator.get(gi)?.includes(v) &&
                  !this.junk.get(gi)?.includes(v),
              ),
              ...(this.creator.get(gi) ?? []).filter(this.visible),
              ...(this.junk.get(gi) ?? []).filter(this.visible),
            ].filter((v) => !short || v.vertical);
      return json({
        items: pool.slice(0, 25).map((v) => ({
          id: { videoId: v.id },
          snippet: { channelId: v.channelId, title: v.title, publishedAt: v.publishedAt.toISOString() },
        })),
      });
    }
    if (path === 'videos') {
      const ids = p.get('id')!.split(',');
      return json({
        items: ids.flatMap((id) => {
          const v = this.videos.get(id);
          if (!v || !this.visible(v)) return [];
          return [
            {
              id,
              snippet: {
                title: v.title,
                description: v.description,
                channelId: v.channelId,
                channelTitle: this.channels.get(v.channelId)?.title ?? '',
                publishedAt: v.publishedAt.toISOString(),
                thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } },
              },
              contentDetails: { duration: v.duration },
              statistics: { viewCount: String(1000 + (hash(id) % 200_000)) },
              player: v.vertical
                ? { embedWidth: '720', embedHeight: '1280' }
                : { embedWidth: '1280', embedHeight: '720' },
              status: { privacyStatus: 'public', embeddable: true },
            },
          ];
        }),
      });
    }
    if (path === 'channels') {
      const ids = (p.get('id') ?? '').split(',').filter(Boolean);
      return json({
        items: ids.flatMap((id) => {
          const c = this.channels.get(id);
          return c
            ? [
                {
                  id,
                  snippet: { title: c.title, customUrl: `@${id.toLowerCase()}`, country: c.country },
                  statistics: { subscriberCount: String(c.subscribers) },
                  contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } },
                },
              ]
            : [];
        }),
      });
    }
    if (path === 'playlistItems') {
      const channelId = `UC${p.get('playlistId')!.slice(2)}`;
      const list = (this.uploads.get(channelId) ?? [])
        .filter(this.visible)
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      const offset = Number(p.get('pageToken') ?? 0);
      const page = list.slice(offset, offset + 50);
      return json({
        ...(offset + 50 < list.length ? { nextPageToken: String(offset + 50) } : {}),
        items: page.map((v) => ({
          snippet: {
            title: v.title,
            description: v.description,
            channelId,
            videoOwnerChannelId: channelId,
            publishedAt: v.publishedAt.toISOString(),
          },
          contentDetails: { videoId: v.id, videoPublishedAt: v.publishedAt.toISOString() },
        })),
      });
    }
    return new Response('{}', { status: 404 });
  };
}

interface Links {
  club: Map<string, string>;
  competition: Map<string, string>;
  /** broadcaster:country → canal */
  broadcaster: Map<string, string>;
}

/** Monta o mundo: canais (os mesmos do mapa) e os vídeos que cada um posta. */
function buildWorld(links: Links): World {
  const w = new World();
  for (const [key, id] of links.club)
    w.channel({ id, title: `Canal oficial ${key}`, subscribers: 1_500_000, country: null });
  for (const [slug, id] of links.competition)
    w.channel({ id, title: `Liga ${slug}`, subscribers: 900_000, country: null });
  for (const [key, id] of links.broadcaster)
    w.channel({ id, title: `Emissora ${key}`, subscribers: 5_000_000, country: key.split(':')[1]! });
  FIXTURE.games.forEach((g, gi) => {
    const end = new Date(Date.parse(g.kickoff) + FINISH_MS);
    const at = (min: number) => new Date(end.getTime() + min * MIN);
    const l = lang(g);
    const [gh, ga] = g.goals ?? [0, 0];
    const vs = l === 'pt' ? `${g.home} ${gh} x ${ga} ${g.away}` : `${g.home} ${gh}-${ga} ${g.away}`;
    for (const team of [g.home, g.away]) {
      const id = links.club.get(team);
      if (!id) continue;
      w.post({
        channelId: id,
        title:
          l === 'pt'
            ? `COLETIVA PÓS-JOGO | ${g.home} x ${g.away}`
            : l === 'es'
              ? `CONFERENCIA DE PRENSA | ${g.home} vs ${g.away}`
              : `PRESS CONFERENCE | ${g.home} v ${g.away}`,
        publishedAt: at(25),
        duration: 'PT18M',
        vertical: false,
        game: gi,
      });
      w.post({
        channelId: id,
        title:
          l === 'pt'
            ? `BASTIDORES | ${g.home} x ${g.away}`
            : l === 'es'
              ? `VESTUARIO | ${g.home} vs ${g.away}`
              : `BEHIND THE SCENES | ${g.home} v ${g.away}`,
        publishedAt: at(70),
        duration: 'PT9M',
        vertical: false,
        game: gi,
      });
      // ruído: o clube posta outras coisas (treino, sem o adversário, no dia seguinte)
      w.post({
        channelId: id,
        title: `Treino de hoje | ${team}`,
        publishedAt: at(14 * 60),
        duration: 'PT5M',
        vertical: false,
        game: -1,
      });
    }
    const comp = links.competition.get(g.slug);
    if (comp)
      w.post({
        channelId: comp,
        title:
          l === 'pt'
            ? `MELHORES MOMENTOS | ${vs}`
            : l === 'es'
              ? `RESUMEN | ${vs} | ${g.competitionName}`
              : `HIGHLIGHTS | ${vs}`,
        publishedAt: at(35),
        duration: 'PT8M',
        vertical: false,
        game: gi,
      });
    const holders = rightsHoldersFor(wtw, g.slug, relatedPolicyFromEnv({}).markets, new Date(g.kickoff));
    for (const [key, id] of links.broadcaster) {
      if (!holders.has(key.split(':')[0]!) || hash(`${key}|${gi}`) % 2) continue;
      w.post({
        channelId: id,
        title: l === 'pt' ? `MELHORES MOMENTOS: ${vs}` : `RESUMEN: ${vs}`,
        publishedAt: at(15),
        duration: 'PT10M',
        vertical: false,
        game: gi,
      });
      w.post({
        channelId: id,
        title: `GOL! ${g.home} x ${g.away} #shorts`,
        publishedAt: at(5),
        duration: 'PT40S',
        vertical: true,
        game: gi,
      });
    }
    // busca: reações de criador (a mesma quantidade de vídeos que a produção publicou; sem histórico, 6 no
    // Brasileirão, 1 nos demais) e lixo que cita um time só
    const creators = g.real.searches > 0 ? g.real.published : g.slug === 'brasileirao-serie-a' ? 6 : 1;
    const creatorChannel = `UCcreator${gi % 7}`;
    w.channel({ id: creatorChannel, title: `Criador ${gi % 7}`, subscribers: 300_000, country: null });
    w.creator.set(
      gi,
      Array.from({ length: creators }, (_, k) =>
        w.post({
          channelId: creatorChannel,
          title: `REACT ${g.home} x ${g.away} - reação do torcedor ${k + 1}`,
          publishedAt: at(40 + k * 20),
          duration: 'PT14M',
          vertical: false,
          game: gi,
        }),
      ),
    );
    const junkChannel = `UCjunk${gi % 5}`;
    w.channel({ id: junkChannel, title: `Canal pequeno ${gi % 5}`, subscribers: 800, country: null });
    w.junk.set(
      gi,
      Array.from({ length: 10 }, (_, k) =>
        w.post({
          channelId: junkChannel,
          title: `${k % 2 ? g.home : g.away} - notícias ${k}`,
          publishedAt: at(10 + k * 6),
          duration: 'PT3M',
          vertical: k % 3 === 0,
          game: gi,
        }),
      ),
    );
  });
  return w;
}

// ── semeadura ────────────────────────────────────────────────────────────────────────────────────

const statusAt = (g: FixtureGame, at: Date) => Date.parse(g.kickoff) + FINISH_MS <= at.getTime();

async function resetEvents(at: Date): Promise<void> {
  await db.execute(
    sql`truncate enrich.related_content, enrich.related_run, enrich.related_budget, enrich.youtube_channel cascade`,
  );
  await advance(at, true);
}

const finished = new Set<number>();

/** Jogos que acabaram até `at` viram `finished` (com placar); os demais ficam `scheduled`. */
async function advance(at: Date, reset = false): Promise<void> {
  if (reset) {
    finished.clear();
    await db.execute(sql`update core.event set status = 'scheduled', status_detail = 'NS', score = null
      where id in ${sql.raw(`(${eventIds.map((id) => `'${id}'`).join(',')})`)}`);
  }
  for (const [i, g] of FIXTURE.games.entries()) {
    if (finished.has(i) || !statusAt(g, at)) continue;
    finished.add(i);
    const score = { home: g.goals?.[0] ?? 0, away: g.goals?.[1] ?? 0 };
    await db.execute(sql`update core.event set status = 'finished', status_detail = 'FT',
      score = ${JSON.stringify(score)}::jsonb where id = ${eventIds[i]!}`);
  }
}

interface SimResult {
  label: string;
  searches: number;
  apiUnits: number;
  /** Consultas gastas até cada horário (UTC). */
  searchesBy: Record<string, number>;
  published: Map<number, number>;
  /** Consultas por jogo. */
  searchesByGame: Map<number, number>;
  /** Jogos pulados por cota no painel (enrich.related_budget). */
  quotaSkipped: number;
}

async function simulate(
  label: string,
  policy: RelatedPolicy,
  allowlist: ChannelAllowlist,
  opts: { limit: number; yieldRows?: CompetitionYieldRow[]; searchDailyQuota?: number },
): Promise<SimResult> {
  await resetEvents(START);
  const links = await worldLinks();
  const world = buildWorld(links);
  const searchesBy: Record<string, number> = {};
  for (let t = START.getTime(); t <= END.getTime() - 1000; t += STEP_MS) {
    const now = new Date(t);
    world.now = now;
    await advance(now);
    const yt = new YoutubeClient({ apiKey: 'sim', fetch: world.fetch });
    const report = await runRelatedAgent(db, {
      now,
      llm: null,
      youtube: yt,
      allowlist,
      wtw,
      policy,
      dailyQuota: 10_000,
      searchDailyQuota: opts.searchDailyQuota ?? 100,
      reservePercent: 10,
      limit: opts.limit,
      ...(opts.yieldRows ? { yieldRows: opts.yieldRows } : {}),
    });
    const errors = report.items.filter((i) => i.action === 'error');
    expect(errors, JSON.stringify(errors.slice(0, 2))).toHaveLength(0);
    const hour = now.toISOString().slice(11, 16);
    if (['12:00', '18:00', '21:00', '00:00', '03:00', '06:45'].includes(hour))
      searchesBy[hour] = report.quota.search.usedBefore + report.quota.search.spent;
  }
  const totals = await db.execute<{ searches: string; api: string }>(
    sql`select coalesce(sum(searches),0)::text as searches, coalesce(sum(api_units),0)::text as api from enrich.related_run`,
  );
  const pub = await db.execute<{ event_id: string; n: number }>(sql`
    select event_id, count(*)::int as n from enrich.related_content
     where superseded_by is null and status = 'published' group by event_id`);
  const byEvent = new Map([...pub].map((r) => [r.event_id, r.n]));
  const perGame = await db.execute<{ event_id: string; n: number }>(sql`
    select event_id, sum(searches)::int as n from enrich.related_run group by event_id`);
  const searchesOf = new Map([...perGame].map((r) => [r.event_id, r.n]));
  const budget = await db.execute<{ n: number }>(
    sql`select coalesce(sum(jsonb_array_length(skipped)), 0)::int as n from enrich.related_budget`,
  );
  return {
    label,
    searches: Number(totals[0]!.searches),
    apiUnits: Number(totals[0]!.api),
    searchesBy,
    published: new Map(eventIds.map((id, i) => [i, byEvent.get(id) ?? 0])),
    searchesByGame: new Map(eventIds.map((id, i) => [i, searchesOf.get(id) ?? 0])),
    quotaSkipped: budget[0]!.n,
  };
}

/** Os canais do mapa (enrich.related_channel), para o mundo postar nos mesmos ids. */
async function worldLinks(): Promise<Links> {
  const rows = await db.execute<{
    channel_id: string;
    kind: string;
    pname: string | null;
    slug: string | null;
    broadcaster_id: string | null;
    country: string | null;
  }>(sql`
    select rc.channel_id, rc.kind, p.name as pname, c.slug, rc.broadcaster_id, rc.country
      from enrich.related_channel rc
      left join core.participant p on p.id = rc.participant_id
      left join core.competition c on c.id = rc.competition_id`);
  const links: Links = { club: new Map(), competition: new Map(), broadcaster: new Map() };
  for (const r of rows) {
    if (r.kind === 'club' && r.pname) links.club.set(r.pname, r.channel_id);
    if (r.kind === 'competition' && r.slug) links.competition.set(r.slug, r.channel_id);
    if (r.kind === 'broadcaster') links.broadcaster.set(`${r.broadcaster_id}:${r.country}`, r.channel_id);
  }
  return links;
}

let compIds: Map<string, string>;

beforeAll(async () => {
  db = await env.setup();
  wtw = loadWtwConfig();
  const codes = [
    ...new Set(FIXTURE.games.flatMap((g) => [g.competitionCountry, g.homeCountry, g.awayCountry])),
  ];
  await db
    .insert(country)
    .values(codes.map((code) => ({ code, name: { en: code } })))
    .onConflictDoNothing();
  const slugs = [...new Map(FIXTURE.games.map((g) => [g.slug, g])).values()];
  compIds = await seedCatalog(
    db,
    slugs.map((g, i) => ({
      slug: g.slug,
      name: g.competitionName,
      leagueId: 5000 + i,
      tier: g.tier,
      type: 'league' as const,
      country: g.competitionCountry,
    })),
  );
  const teamIds = new Map<string, number>();
  const teamId = (name: string) => {
    if (!teamIds.has(name)) teamIds.set(name, 70_000 + teamIds.size);
    return teamIds.get(name)!;
  };
  const fixtures = FIXTURE.games.map((g, i) =>
    syntheticFixture({
      id: 900_000 + i,
      league: {
        id: 5000 + slugs.findIndex((s) => s.slug === g.slug),
        name: g.competitionName,
        country: g.competitionCountry,
        season: 2026,
        round: 'Regular Season - 30',
      },
      date: g.kickoff,
      home: { id: teamId(g.home), name: g.home },
      away: { id: teamId(g.away), name: g.away },
      status: 'NS',
    }),
  );
  await ingest(db, fixtures, new Date('2026-10-23T12:00:00Z'));
  for (const [i, g] of FIXTURE.games.entries()) {
    const id = await idOf(db, 'event', 900_000 + i);
    eventIds.push(id);
    await db.execute(sql`update core.event set importance = ${g.importance} where id = ${id}`);
  }
  const countryOf = new Map(
    FIXTURE.games.flatMap(
      (g) =>
        [
          [g.home, g.homeCountry],
          [g.away, g.awayCountry],
        ] as const,
    ),
  );
  const qidOf = new Map(
    FIXTURE.games.flatMap(
      (g) =>
        [
          [g.home, g.homeQid],
          [g.away, g.awayQid],
        ] as const,
    ),
  );
  const participants = new Map<string, string>();
  for (const [name, pid] of teamIds) {
    const id = await idOf(db, 'participant', pid);
    participants.set(name, id);
    await db.execute(
      sql`update core.participant set country_code = ${countryOf.get(name) ?? null} where id = ${id}`,
    );
  }

  // mapa de canais, como o deixam os CLIs de carga (canais:wikidata + related:canais)
  const rows: (typeof relatedChannel.$inferInsert)[] = [];
  for (const [name, pid] of participants) {
    const qid = qidOf.get(name);
    for (const ch of qid ? (FIXTURE.wikidataChannels[qid] ?? []) : [])
      rows.push({ channelId: ch, kind: 'club', participantId: pid, source: 'wikidata', sourceRef: qid });
  }
  for (const [slug, qid] of Object.entries(FIXTURE.competitionQids)) {
    const cid = compIds.get(slug);
    for (const ch of cid ? (FIXTURE.wikidataChannels[qid] ?? []) : [])
      rows.push({
        channelId: ch,
        kind: 'competition',
        competitionId: cid,
        source: 'wikidata',
        sourceRef: qid,
      });
  }
  // channels.yaml: canais de liga com handle conferido
  for (const [slug, handle] of [['argentina-liga-profesional', 'ligaprofesional']] as const)
    rows.push({
      channelId: `UCcfg${handle}`,
      kind: 'competition',
      competitionId: compIds.get(slug)!,
      source: 'config',
      sourceRef: 'related-content/channels.yaml',
    });
  // emissoras com canal no YouTube (channels.yaml + dicionário), por mercado
  const seen = new Set<string>();
  for (const e of [...loadChannelEntries(), ...broadcasterChannelsFrom(wtw)]) {
    if (e.kind !== 'broadcaster' || !e.broadcaster || !e.country) continue;
    const key = `${e.broadcaster}:${e.country}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      channelId: `UCb${e.broadcaster}${e.country}`,
      kind: 'broadcaster',
      broadcasterId: e.broadcaster,
      country: e.country,
      source: 'config',
      sourceRef: e.handle ?? null,
    });
  }
  await db.insert(relatedChannel).values(rows).onConflictDoNothing();
}, 600_000);

afterAll(async () => {
  await env.teardown();
});

describe('simulação do dia de cota 2026-10-24 (antes × depois)', () => {
  it('cobre os jogos grandes da noite e rende mais com menos busca', async () => {
    const base = relatedPolicyFromEnv({});
    const legacy: RelatedPolicy = {
      ...base,
      channelsFirst: false,
      reserveMaxPercent: 0,
      marketWeights: Object.fromEntries(base.markets.map((m) => [m, 1])),
      maxSearchesPerRun: 4,
      maxSearchesPerEvent: 8,
      revalidateMinutes: 15,
      channelRefreshMinutes: 0,
      searchAfterKickoffMinutes: 0,
      foreignLast: false,
    };
    const configOnly = new ChannelAllowlist({
      entries: [...loadChannelEntries(), ...broadcasterChannelsFrom(wtw)],
      blocklist: wtw.blocklist,
    });
    const before = await simulate('antes', legacy, configOnly, { limit: 20 });
    const withMap = new ChannelAllowlist({
      entries: [
        ...loadChannelEntries(),
        ...broadcasterChannelsFrom(wtw),
        ...(await channelEntriesFromDb(db)),
      ],
      blocklist: wtw.blocklist,
    });
    const yieldRows = HISTORY.flatMap((h) => {
      const id = compIds.get(h.slug);
      return id ? [{ ...h, competitionId: id, channelVideos: 0 }] : [];
    });
    const after = await simulate('depois', base, withMap, { limit: 60, yieldRows });
    // demanda: as regras novas sem teto no balde de busca (quantas consultas o dia pediria)
    const demand = await simulate('depois, sem teto de busca', base, withMap, {
      limit: 60,
      yieldRows,
      searchDailyQuota: 100_000,
    });

    // grupos de jogos para o relatório
    const games = FIXTURE.games.map((g, i) => ({ g, i }));
    const round07 = games.filter(({ g }) => g.real.searches > 0); // os 19 da rodada das 07:00 na produção
    const night = games.filter(
      ({ g }) =>
        g.slug === 'brasileirao-serie-a' && Date.parse(g.kickoff) >= Date.parse('2026-10-24T19:00:00Z'),
    );
    const markets = new Set(base.markets);
    const inMarket = games.filter(({ g }) => markets.has(g.competitionCountry));
    const covered = (r: SimResult, list: typeof games) =>
      list.filter(({ i }) => (r.published.get(i) ?? 0) > 0).length;
    const videos = (r: SimResult, list: typeof games) =>
      list.reduce((a, { i }) => a + (r.published.get(i) ?? 0), 0);
    const row = (name: string, list: typeof games) => ({
      grupo: name,
      jogos: list.length,
      'cobertos antes': covered(before, list),
      'cobertos depois': covered(after, list),
      'cobertos sem teto': covered(demand, list),
      'vídeos antes': videos(before, list),
      'vídeos depois': videos(after, list),
    });
    console.log('\nSimulação do dia de cota 2026-10-24 (cron a cada 15 min, 07:00 → 07:00 UTC)');
    console.table([
      row('rodada das 07:00 (19 da produção)', round07),
      row('Série A da noite (19:30–00:00 UTC)', night),
      row('mercados ativos (todos)', inMarket),
      row('todos os 142', games),
    ]);
    console.table(
      [before, after, demand].map((r) => ({
        regra: r.label,
        'consultas (balde de busca, 90 úteis)': r.searches,
        'unidades (balde geral, 9.000 úteis)': r.apiUnits,
        ...Object.fromEntries(Object.entries(r.searchesBy).map(([h, n]) => [`busca até ${h}`, n])),
        'vídeos por consulta': r.searches ? Math.round((videos(r, games) / r.searches) * 10) / 10 : null,
        'pulados por cota': r.quotaSkipped,
      })),
    );
    const bySlug = [...new Set(FIXTURE.games.map((g) => g.slug))].map((slug) => {
      const list = games.filter(({ g }) => g.slug === slug);
      const sum = (r: SimResult) => list.reduce((a, { i }) => a + (r.searchesByGame.get(i) ?? 0), 0);
      return {
        competição: slug,
        jogos: list.length,
        'consultas antes': sum(before),
        'vídeos antes': videos(before, list),
        'consultas depois': sum(after),
        'cobertos depois': covered(after, list),
        'vídeos depois': videos(after, list),
        'consultas sem teto': sum(demand),
      };
    });
    console.table(
      bySlug.sort(
        (a, b) => b['consultas antes'] + b['consultas depois'] - a['consultas antes'] - a['consultas depois'],
      ),
    );
    console.table(
      night.map(({ g, i }) => ({
        jogo: `${g.home} x ${g.away}`,
        inicio: g.kickoff.slice(11, 16),
        antes: before.published.get(i),
        depois: after.published.get(i),
      })),
    );

    expect(after.searches).toBeLessThanOrEqual(90);
    expect(after.apiUnits).toBeLessThan(9000);
    // os grandes da noite: todos com vídeo (antes: a rodada das 07:00 gastou a busca)
    expect(covered(after, night)).toBe(night.length);
    expect(covered(after, night)).toBeGreaterThan(covered(before, night));
    expect(covered(after, inMarket)).toBeGreaterThan(covered(before, inMarket));
    expect(videos(after, games)).toBeGreaterThan(videos(before, games));
  }, 1_800_000);
});
