import { eq, inArray } from 'drizzle-orm';
import { teamColors } from '../teams/colors.js';
import type { Event, EventParticipant, EventStake, ScorePeriod, SupportedLocale } from '@galaxie/contracts';
import {
  asset,
  competition,
  competitionProfile,
  derby,
  event,
  eventParticipant,
  footballFixture,
  participant,
  season,
  stage,
  standing,
  teamProfile,
  venue,
  venueDisplay,
  type Database,
  type EventScore,
} from '@galaxie/db';
import { isInPlay, momentum } from '@galaxie/providers';
import {
  fanTags,
  fanTagStanding,
  knockoutStageRules,
  knockoutStakes,
  leagueMatchStakes,
  localizeStake,
  type CompetitionRules,
  type FanTagLocale,
  type FanTagStanding,
  type Fixture,
  type Stake,
  type StakeLocale,
} from '@galaxie/rules';
import { formatInstant, pickList, pickText } from '../i18n.js';
import { assetUrl } from '../util.js';
import { pickCheer } from './cheer.js';
import { loadRaceSessions, loadRaceTeams, raceResult } from './race.js';
import { importanceBreakdownDto } from './relevance.js';
import { venueTimezone } from './timezone.js';
import type { RulesRegistry } from './rules-registry.js';

/** Fases de mata-mata (core.stage.kind). */
export const KNOCKOUT_KINDS = new Set([
  'knockout_round',
  'round_of_128',
  'round_of_64',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
  'playoff',
]);
/** Fases de pontos corridos (liga, grupo, fase de liga). */
export const LEAGUE_KINDS = new Set(['regular', 'group', 'league_phase']);

const ORDINAL_KEYS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/**
 * Chave da fase no regulamento: igual ao `kind`, exceto as fases numeradas de copa
 * ("1st Round" → `first_round`), que o YAML nomeia por extenso (ex.: copa-do-brasil).
 */
export function rulesStageKey(kind: string, providerLabel: string | null): string {
  if (kind === 'knockout_round' && providerLabel) {
    const n = /^(\d+)(st|nd|rd|th)\s+round/i.exec(providerLabel.trim())?.[1];
    const key = n ? ORDINAL_KEYS[Number(n) - 1] : undefined;
    if (key) return `${key}_round`;
  }
  return kind;
}

export interface BuildContext {
  db: Database;
  locale: SupportedLocale;
  tz: string;
  now: Date;
  assetsBaseUrl: string | undefined;
  rules: RulesRegistry;
}

type Pair = { home: number | null; away: number | null };

/** Partida mínima usada para chaveamento (ida/volta) e rodada. */
export interface StageMatch {
  id: string;
  stageId: string;
  startsAt: Date;
  status: Event['status'];
  score: EventScore | null;
  homeId: string | null;
  awayId: string | null;
}

/** Confronto de mata-mata: as partidas do mesmo par na mesma fase, em ordem cronológica. */
export function pairKey(a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ordem de jogo dos parciais: o jsonb não guarda a ordem das chaves (ordena por tamanho e texto)
const PERIOD_ORDER = [
  ...['s1', 's2', 's3', 's4', 's5'],
  ...['q1', 'q2', 'q3', 'q4', 'h1', 'h2', 'p1', 'p2', 'p3'],
  ...Array.from({ length: 9 }, (_, i) => `i${i + 1}`),
  ...['extra', 'ot', 'ot2', 'so'],
];

/** `score.periods` do core (objeto) → lista na ordem do jogo, sem os períodos não disputados. */
export function scorePeriods(
  periods: Record<string, { home: number | null; away: number | null }> | null | undefined,
): ScorePeriod[] | null {
  if (!periods) return null;
  const rank = (code: string) => {
    const i = PERIOD_ORDER.indexOf(code);
    return i < 0 ? PERIOD_ORDER.length : i;
  };
  const list = Object.entries(periods)
    .filter(([, p]) => p && (p.home != null || p.away != null))
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([code, p]) => ({ code, home: p.home ?? null, away: p.away ?? null }));
  return list.length ? list : null;
}

/** Gols de cada participante numa partida (null se não houver placar). */
export function goalsOf(m: StageMatch): Map<string, number> | null {
  if (!m.homeId || !m.awayId || m.score?.home == null || m.score.away == null) return null;
  return new Map([
    [m.homeId, m.score.home],
    [m.awayId, m.score.away],
  ]);
}

/** Agrupa partidas de uma fase por confronto. */
export function groupTies(matches: StageMatch[]): Map<string, StageMatch[]> {
  const ties = new Map<string, StageMatch[]>();
  for (const m of [...matches].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const key = pairKey(m.homeId, m.awayId);
    if (!key) continue;
    const list = ties.get(`${m.stageId}|${key}`) ?? [];
    list.push(m);
    ties.set(`${m.stageId}|${key}`, list);
  }
  return ties;
}

export async function loadStageMatches(db: Database, stageIds: string[]): Promise<StageMatch[]> {
  if (!stageIds.length) return [];
  const rows = await db
    .select({
      id: event.id,
      stageId: event.stageId,
      startsAt: event.startsAt,
      status: event.status,
      score: event.score,
      participantId: eventParticipant.participantId,
      side: eventParticipant.side,
    })
    .from(event)
    .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
    .where(inArray(event.stageId, stageIds));
  const byId = new Map<string, StageMatch>();
  for (const r of rows) {
    const m = byId.get(r.id) ?? {
      id: r.id,
      stageId: r.stageId!,
      startsAt: r.startsAt,
      status: r.status,
      score: r.score ?? null,
      homeId: null,
      awayId: null,
    };
    if (r.side === 'home') m.homeId = r.participantId;
    if (r.side === 'away') m.awayId = r.participantId;
    byId.set(r.id, m);
  }
  return [...byId.values()];
}

/** Esportes em que o placar conta sets: o mata-mata é série, sem ida/volta nem agregado. */
const SERIES_SPORTS = new Set(['volleyball']);

/**
 * Pernas do confronto: as do regulamento ou, sem ele, 2 quando o par tem dois jogos na fase. No vôlei, dois
 * jogos do mesmo par são uma série (melhor de 3), não ida e volta: sets não se somam num agregado.
 */
export function tieLegs(sport: string, ruleLegs: number | undefined, tieSize: number): number {
  if (SERIES_SPORTS.has(sport)) return 1;
  return ruleLegs ?? (tieSize === 2 ? 2 : 1);
}

const LEG_NAMES: Record<string, [string, string]> = {
  pt: ['Ida', 'Volta'],
  es: ['Ida', 'Vuelta'],
};

const TITLE_FAMILIES = new Set([
  'mathematically_champion',
  'clinches_title_with_draw',
  'clinches_title_with_win',
  'can_clinch_title',
  'in_title_race',
  'decides_title',
]);
const RELEGATION_FAMILIES = new Set([
  'mathematically_relegated',
  'relegated_unless_wins',
  'relegated_if_loses',
  'can_be_relegated',
  'at_risk_of_relegation',
  'secures_safety_with_draw',
  'secures_safety_with_win',
  'can_secure_safety',
]);

/** Stakes que tornam um jogo "decisivo" no contexto da competição. */
export const DECISIVE_FAMILIES = new Set([
  'advances_with_draw',
  'advances_with_loss_by_n',
  'needs_win',
  'needs_win_by_n',
  'win_by_n_goes_to_penalties',
  'win_by_n_goes_to_extra_time',
  'draw_goes_to_penalties',
  'draw_goes_to_extra_time',
  'advances_with_draw_up_to_n',
  'advances_with_draw_from_n',
  'specific_draw_goes_to_penalties',
  'specific_draw_goes_to_extra_time',
  'outcome_depends_on_away_goals',
  'decides_title',
  'clinches_title_with_draw',
  'clinches_title_with_win',
  'can_clinch_title',
  'clinches_zone_with_draw',
  'clinches_zone_with_win',
  'can_clinch_zone',
  'relegated_unless_wins',
  'relegated_if_loses',
  'can_be_relegated',
  'secures_safety_with_draw',
  'secures_safety_with_win',
  'can_secure_safety',
  'eliminated_unless_wins',
  'eliminated_if_loses',
  'can_be_eliminated',
]);

/**
 * Árbitro no formato do fornecedor ("Nome, País" ou só "Nome") → `{ name, country }`. O país é o último
 * trecho depois da vírgula; vazio ou só espaços → null.
 */
export function parseReferee(raw: string | null | undefined): Event['referee'] {
  const text = raw?.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const i = text.lastIndexOf(',');
  if (i <= 0) return { name: text, country: null };
  const name = text.slice(0, i).trim();
  const country = text.slice(i + 1).trim();
  if (!name) return { name: country, country: null };
  return { name, country: country || null };
}

export interface BuiltEvent {
  dto: Event;
  /** Famílias dos stakes (para filtrar jogos decisivos). */
  stakeFamilies: string[];
}

/**
 * Monta eventos canônicos (docs/05 §3.2) em lote, preservando a ordem dos IDs:
 * participantes, competição (com apelido), fase e perna, placar com agregado, clássico,
 * momentum no fuso do cliente, contexto competitivo e stakes do motor de regras.
 */
export async function buildEvents(ctx: BuildContext, ids: string[]): Promise<BuiltEvent[]> {
  if (!ids.length) return [];
  const { db, locale } = ctx;
  const rows = await db
    .select({
      e: event,
      c: {
        id: competition.id,
        slug: competition.slug,
        name: competition.name,
        labels: competition.labels,
        country: competition.countryCode,
      },
      cLogoKey: asset.storageKey,
      cLogoUrl: asset.sourceUrl,
      st: { id: stage.id, kind: stage.kind, name: stage.name, providerLabel: stage.providerLabel },
      seasonYear: season.year,
      v: {
        id: venue.id,
        name: venue.name,
        city: venue.city,
        curated: venue.curated,
        country: venue.countryCode,
      },
      d: { slug: derby.slug, name: derby.name, labels: derby.labels, intensity: derby.intensity },
      // árbitro: só no espelho do futebol (`core.football_fixture`, 1:1 com o evento)
      referee: footballFixture.referee,
    })
    .from(event)
    .leftJoin(competition, eq(competition.id, event.competitionId))
    .leftJoin(asset, eq(asset.id, competition.logoAssetId))
    .leftJoin(stage, eq(stage.id, event.stageId))
    .leftJoin(season, eq(season.id, event.seasonId))
    .leftJoin(venue, eq(venue.id, event.venueId))
    .leftJoin(derby, eq(derby.id, event.derbyId))
    .leftJoin(footballFixture, eq(footballFixture.eventId, event.id))
    .where(inArray(event.id, ids));

  const competitionIds = [...new Set(rows.map((r) => r.c?.id).filter((x): x is string => !!x))];
  const profiles = competitionIds.length
    ? await db
        .select({
          competitionId: competitionProfile.competitionId,
          labels: competitionProfile.labels,
          nicknames: competitionProfile.nicknames,
        })
        .from(competitionProfile)
        .where(inArray(competitionProfile.competitionId, competitionIds))
    : [];
  const profileBy = new Map(profiles.map((p) => [p.competitionId!, p]));

  // participantes
  const partRows = await db
    .select({
      eventId: eventParticipant.eventId,
      side: eventParticipant.side,
      position: eventParticipant.position,
      result: eventParticipant.result,
      p: { id: participant.id, name: participant.name, shortName: participant.shortName },
      country: participant.countryCode,
      logoKey: asset.storageKey,
      logoUrl: asset.sourceUrl,
      logoPalette: asset.palette,
      nicknames: teamProfile.nicknames,
      rallyingCries: teamProfile.rallyingCries,
      copyHints: teamProfile.copyHints,
      profileSources: teamProfile.sources,
    })
    .from(eventParticipant)
    .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
    .leftJoin(asset, eq(asset.id, participant.logoAssetId))
    .leftJoin(teamProfile, eq(teamProfile.participantId, participant.id))
    .where(inArray(eventParticipant.eventId, ids));
  const sideOrder = (s: string) => (s === 'home' ? 0 : s === 'away' ? 1 : 2);
  const partsBy = new Map<string, (EventParticipant & { _pos: number | null; _result: unknown })[]>();
  // país do mandante: fallback do fuso do local quando o local não tem país
  const homeCountryBy = new Map<string, string | null>();
  for (const r of partRows) {
    if (r.side === 'home') homeCountryBy.set(r.eventId, r.country);
    const list = partsBy.get(r.eventId) ?? [];
    if (list.some((x) => x.id === r.p.id)) continue;
    const winner = (r.result as { winner?: unknown } | null)?.winner;
    list.push({
      side: r.side,
      id: r.p.id,
      name: r.p.name,
      short_name: r.p.shortName,
      logo: assetUrl(ctx.assetsBaseUrl, r.logoKey, r.logoUrl),
      nickname: r.nicknames?.[0] ?? null,
      colors: teamColors(r.logoPalette),
      winner: typeof winner === 'boolean' ? winner : null,
      // preenchidas depois dos stakes
      fan_tags: [],
      // grito da torcida pelo mesmo caminho do apelido (perfil semântico ligado ao participante)
      cheer: pickCheer(
        { rallyingCries: r.rallyingCries, copyHints: r.copyHints, sources: r.profileSources },
        locale,
      ),
      _pos: r.position,
      _result: r.result,
    });
    partsBy.set(r.eventId, list);
  }
  // corridas (F1): sessão do fim de semana e equipe de cada piloto no resultado
  const sessions = await loadRaceSessions(db, ids, locale);
  const gridResults = partRows.filter((r) => r.side === 'grid').map((r) => r.result);
  const raceTeams = gridResults.length
    ? await loadRaceTeams(db, 'formula-1', gridResults, ctx.assetsBaseUrl)
    : new Map();
  const sideId = (eventId: string, side: 'home' | 'away') =>
    partsBy.get(eventId)?.find((p) => p.side === side)?.id ?? null;

  // regulamentos
  const rulesBy = new Map<string, CompetitionRules | null>();
  await Promise.all(
    rows
      .filter((r) => r.c?.slug)
      .map(async (r) => {
        const key = `${r.c!.slug}|${r.seasonYear ?? ''}`;
        if (!rulesBy.has(key)) rulesBy.set(key, await ctx.rules.get(r.c!.slug, r.seasonYear));
      }),
  );
  const rulesOf = (r: (typeof rows)[number]) =>
    r.c?.slug ? (rulesBy.get(`${r.c.slug}|${r.seasonYear ?? ''}`) ?? null) : null;

  // partidas das fases relevantes: chaveamento (mata-mata) e rodada atual (pontos corridos)
  const open = (s: Event['status']) => s !== 'finished' && s !== 'cancelled' && s !== 'abandoned';
  const stageIds = new Set<string>();
  const leagueSeasons = new Set<string>();
  for (const r of rows) {
    if (!r.st?.id) continue;
    if (KNOCKOUT_KINDS.has(r.st.kind)) stageIds.add(r.st.id);
    else if (LEAGUE_KINDS.has(r.st.kind) && open(r.e.status)) {
      stageIds.add(r.st.id);
      if (r.e.seasonId) leagueSeasons.add(r.e.seasonId);
    }
  }
  const stageMatches = await loadStageMatches(db, [...stageIds]);
  const ties = groupTies(stageMatches.filter((m) => m.status !== 'cancelled'));
  const matchesByStage = new Map<string, StageMatch[]>();
  for (const m of stageMatches) {
    const list = matchesByStage.get(m.stageId) ?? [];
    list.push(m);
    matchesByStage.set(m.stageId, list);
  }

  const standingsRows = leagueSeasons.size
    ? await db
        .select({
          seasonId: standing.seasonId,
          group: standing.group,
          participantId: standing.participantId,
          rank: standing.rank,
          points: standing.points,
          played: standing.played,
        })
        .from(standing)
        .where(inArray(standing.seasonId, [...leagueSeasons]))
    : [];
  const tablesBySeason = new Map<string, Map<string, typeof standingsRows>>();
  for (const s of standingsRows) {
    const groups = tablesBySeason.get(s.seasonId) ?? new Map<string, typeof standingsRows>();
    const g = groups.get(s.group) ?? [];
    g.push(s);
    groups.set(s.group, g);
    tablesBySeason.set(s.seasonId, groups);
  }
  for (const groups of tablesBySeason.values())
    for (const g of groups.values()) g.sort((a, b) => a.rank - b.rank || b.points - a.points);

  const lang = locale.split('-')[0]!;
  const out: BuiltEvent[] = [];
  const rowBy = new Map(rows.map((r) => [r.e.id, r]));
  for (const id of ids) {
    const r = rowBy.get(id);
    if (!r) continue;
    const e = r.e;
    const homeId = sideId(id, 'home');
    const awayId = sideId(id, 'away');
    const rules = rulesOf(r);
    const stageKind = r.st?.kind ?? null;
    const stakes: Stake[] = [];
    // situação na tabela por lado: filtra as tags do torcedor de mera possibilidade (pontos corridos)
    const standings: Partial<Record<'home' | 'away', FanTagStanding | null>> = {};
    const contexts = new Set<Event['competition_context'][number]>();

    // ── perna e agregado (mata-mata) ──
    let leg: number | null = null;
    let aggregate: Pair | null = null;
    let firstLeg: StageMatch | undefined;
    if (r.st?.id && stageKind && KNOCKOUT_KINDS.has(stageKind)) {
      const key = pairKey(homeId, awayId);
      const tie = key ? (ties.get(`${r.st.id}|${key}`) ?? []) : [];
      const stageRules = rules
        ? knockoutStageRules(rules, rulesStageKey(stageKind, r.st.providerLabel))
        : null;
      const legs = tieLegs(e.sport, stageRules?.legs, tie.length);
      if (legs === 2 && tie.length === 2) {
        leg = tie[0]!.id === id ? 1 : tie[1]!.id === id ? 2 : null;
        firstLeg = tie[0];
      }
      if (leg === 2 && firstLeg && firstLeg.status === 'finished' && homeId && awayId) {
        const g = goalsOf(firstLeg);
        if (g) {
          aggregate = {
            home: (g.get(homeId) ?? 0) + (e.score?.home ?? 0),
            away: (g.get(awayId) ?? 0) + (e.score?.away ?? 0),
          };
        }
      }
      // stakes do mata-mata: só antes/durante o jogo e com regulamento próprio
      if (stageRules && rules?.knockout && open(e.status) && homeId && awayId) {
        try {
          if (legs === 1) stakes.push(...knockoutStakes({ rules: stageRules }));
          else if (leg === 1) stakes.push(...knockoutStakes({ rules: stageRules, leg: 1 }));
          else if (leg === 2 && firstLeg?.status === 'finished') {
            const g = goalsOf(firstLeg);
            if (g)
              stakes.push(
                ...knockoutStakes({
                  rules: stageRules,
                  leg: 2,
                  // placar da ida com os mandos da ida: o mandante da volta foi o visitante da ida
                  firstLeg: { homeGoals: g.get(awayId) ?? 0, awayGoals: g.get(homeId) ?? 0 },
                }),
              );
          }
        } catch {
          // dado incompatível com o regulamento: sem stakes
        }
      }
      if (stageKind === 'final') contexts.add('final');
      else if (stageKind === 'semi_final') contexts.add('semifinal');
      if (stageKind === 'playoff') contexts.add('playoff');
      else contexts.add('knockout');
    }

    // ── pontos corridos: líder e stakes ──
    if (stageKind && LEAGUE_KINDS.has(stageKind)) {
      contexts.add('regular');
      const groups = e.seasonId ? tablesBySeason.get(e.seasonId) : undefined;
      const table =
        groups && homeId && awayId
          ? [...groups.values()].find(
              (g) => g.some((s) => s.participantId === homeId) && g.some((s) => s.participantId === awayId),
            )
          : undefined;
      if (table?.[0] && (table[0].participantId === homeId || table[0].participantId === awayId))
        contexts.add('lead');
      if (table && rules?.league && open(e.status) && homeId && awayId && r.st?.id) {
        const inTable = new Set(table.map((s) => s.participantId));
        const nextRound: Fixture[] = (matchesByStage.get(r.st.id) ?? [])
          .filter(
            (m) =>
              m.id !== id &&
              open(m.status) &&
              m.homeId &&
              m.awayId &&
              inTable.has(m.homeId) &&
              inTable.has(m.awayId),
          )
          .map((m) => ({ homeId: m.homeId!, awayId: m.awayId! }));
        const leagueTable = table.map((s) => ({
          teamId: s.participantId,
          points: s.points,
          played: s.played,
        }));
        standings.home = fanTagStanding(leagueTable, rules.league, homeId);
        standings.away = fanTagStanding(leagueTable, rules.league, awayId);
        try {
          stakes.push(
            ...leagueMatchStakes({
              table: leagueTable,
              league: rules.league,
              points: rules.standings.points,
              homeId,
              awayId,
              nextRound,
            }),
          );
        } catch {
          // tabela incompatível com o regulamento (ex.: mais jogos que o previsto): sem stakes
        }
      }
    }
    if (r.d?.slug) contexts.add('derby');
    for (const s of stakes) {
      if (TITLE_FAMILIES.has(s.family)) contexts.add('title');
      if (RELEGATION_FAMILIES.has(s.family)) contexts.add('relegation');
    }

    const profile = r.c ? profileBy.get(r.c.id) : undefined;
    const labels = { ...(r.c?.labels ?? {}), ...(profile?.labels ?? {}) } as Record<string, string>;
    const stageName = r.st
      ? pickText(r.st.name as Record<string, string>, locale, r.st.providerLabel ?? '')
      : null;
    const legName = leg ? (LEG_NAMES[lang] ?? LEG_NAMES.es!)[leg - 1] : null;
    const pair = (p: Pair | null | undefined): Pair | null =>
      p && (p.home != null || p.away != null) ? { home: p.home ?? null, away: p.away ?? null } : null;
    const participants = (partsBy.get(id) ?? [])
      // sem posição (abandono, sem resultado) vai para o fim
      .sort((a, b) => sideOrder(a.side) - sideOrder(b.side) || (a._pos ?? 999) - (b._pos ?? 999))
      .map(({ _pos, _result, ...p }): EventParticipant => ({
        ...p,
        // vários participantes (F1): posição e resultado; mandante × visitante segue sem os campos
        ...(p.side === 'grid' ? { position: _pos, result: raceResult(_result, raceTeams) } : {}),
        // tags do torcedor por lado (stakes `both` valem para os dois), no locale da resposta
        fan_tags:
          p.side === 'home' || p.side === 'away'
            ? fanTags(stakes, p.side, [locale as FanTagLocale], undefined, standings[p.side]).map((t) => ({
                code: t.code,
                priority: t.priority,
                text: t.text as Record<string, string>,
              }))
            : [],
      }));
    const teamIdOf = (team: Stake['team']) => (team === 'home' ? homeId : team === 'away' ? awayId : null);

    const dto: Event = {
      id,
      sport: e.sport,
      competition: r.c?.id
        ? {
            id: r.c.id,
            slug: r.c.slug,
            name: pickText(labels, locale, r.c.name)!,
            nickname: pickList(profile?.nicknames, locale)[0] ?? null,
            logo: assetUrl(ctx.assetsBaseUrl, r.cLogoKey, r.cLogoUrl),
          }
        : null,
      stage: r.st?.id
        ? {
            kind: r.st.kind,
            leg,
            name: stageName ? (legName ? `${stageName} · ${legName}` : stageName) : null,
          }
        : null,
      starts_at: formatInstant(e.startsAt, ctx.tz),
      status: e.status,
      status_detail: e.statusDetail,
      clock: e.clock
        ? { minute: e.clock.minute ?? null, extra: e.clock.extra ?? null, period: e.clock.period ?? null }
        : null,
      momentum: momentum({ status: e.status, startsAt: e.startsAt }, ctx.now, ctx.tz),
      importance: e.importance,
      importance_breakdown: importanceBreakdownDto(e.importanceBreakdown),
      // relevância por mercado: preenchida pela rota (applyRelevance*), que conhece o `market`
      relevance: null,
      relevance_by_market: null,
      participants,
      ...(sessions.has(id) ? { session: sessions.get(id)! } : {}),
      score: {
        home: e.score?.home ?? null,
        away: e.score?.away ?? null,
        halftime: pair(e.score?.halftime),
        extratime: pair(e.score?.extratime),
        penalty: pair(e.score?.penalty),
        aggregate: aggregate ?? pair(e.score?.aggregate),
        periods: scorePeriods(e.score?.periods),
      },
      // nome curado da base semântica vence o do fornecedor (naming rights); o fuso usa a cidade do core
      venue: r.v?.id
        ? {
            id: r.v.id,
            ...venueDisplay(r.v),
            timezone: venueTimezone([r.v.country, homeCountryBy.get(id), r.c?.country], r.v.city),
          }
        : null,
      referee: parseReferee(r.referee),
      derby: r.d?.slug
        ? {
            slug: r.d.slug,
            name: pickText(r.d.labels as Record<string, string>, locale, r.d.name)!,
            intensity: r.d.intensity,
          }
        : null,
      competition_context: [...contexts],
      stakes: stakes.map((s): EventStake => {
        const l = localizeStake(s, [locale as StakeLocale]);
        return {
          team: l.team,
          team_id: teamIdOf(l.team),
          code: l.code,
          text: l.text as Record<string, string>,
        };
      }),
      data_freshness: {
        last_valid_at: e.lastValidAt ? formatInstant(e.lastValidAt, ctx.tz) : null,
        is_stale: e.isStale,
      },
    };
    out.push({ dto, stakeFamilies: stakes.map((s) => s.family) });
  }
  return out;
}

/**
 * TTL (s) de uma resposta com eventos: ao vivo (ou começando em até 2 h) 10 s; agenda 5 min;
 * apenas encerrados 1 h. Respeita `base` como teto.
 */
export function eventsTtl(events: Pick<Event, 'status' | 'starts_at'>[], now: Date, base = 3600): number {
  let ttl = base;
  for (const e of events) {
    const startsIn = Date.parse(e.starts_at) - now.getTime();
    if (
      isInPlay(e.status) ||
      e.status === 'starting' ||
      (e.status === 'scheduled' && startsIn < 2 * 3600_000)
    )
      return 10;
    if (e.status === 'scheduled' || e.status === 'postponed') ttl = Math.min(ttl, 300);
  }
  return ttl;
}
