import { eq, inArray } from 'drizzle-orm';
import type { PersonMatch, PersonOverview, PersonSeasonStats } from '@galaxie/contracts';
import {
  asset,
  competition,
  competitionProfile,
  participant,
  person as personTable,
  type Database,
} from '@galaxie/db';
import { buildEvents } from '../events/builder.js';
import type { BuildContext } from '../events/builder.js';
import { pickText } from '../i18n.js';
import { teamColors } from '../teams/colors.js';
import { assetUrl } from '../util.js';
import { loadPerson } from './person.js';
import {
  coachCareerTeams,
  coachLines,
  coreIds,
  incidentTeams,
  nationalityResolver,
  personSeasonRows,
  personSidelinedRows,
  personTransferRows,
  personTrophyRows,
  playerLines,
  playerTransfers,
  providerIds,
  type PlayerLine,
} from './queries.js';
import {
  addNumbers,
  matchNumbers,
  mostCommon,
  pickNumbers,
  providerNumbers,
  sumNumbers,
  type MatchNumbers,
  type SummedNumbers,
} from './stats.js';

/** Jogos recentes no perfil. */
const RECENT_MATCHES = 10;

type Line = PlayerLine & { n: MatchNumbers; teamId: string | null };

async function participantRefs(db: Database, assetsBaseUrl: string | undefined, ids: string[]) {
  if (!ids.length) return new Map<string, ReturnType<typeof toRef>>();
  const rows = await db
    .select({
      id: participant.id,
      name: participant.name,
      shortName: participant.shortName,
      logoKey: asset.storageKey,
      logoUrl: asset.sourceUrl,
      palette: asset.palette,
    })
    .from(participant)
    .leftJoin(asset, eq(asset.id, participant.logoAssetId))
    .where(inArray(participant.id, [...new Set(ids)]));
  function toRef(r: (typeof rows)[number]) {
    return {
      ref: {
        id: r.id,
        name: r.name,
        short_name: r.shortName,
        logo: assetUrl(assetsBaseUrl, r.logoKey, r.logoUrl),
      },
      palette: r.palette,
    };
  }
  return new Map(rows.map((r) => [r.id, toRef(r)]));
}

async function competitionRefs(
  db: Database,
  assetsBaseUrl: string | undefined,
  locale: string,
  ids: string[],
) {
  if (!ids.length) return new Map<string, { ref: PersonSeasonStats['competition']; tier: number }>();
  const rows = await db
    .select({
      id: competition.id,
      slug: competition.slug,
      name: competition.name,
      labels: competition.labels,
      tier: competition.tier,
      profileLabels: competitionProfile.labels,
      logoKey: asset.storageKey,
      logoUrl: asset.sourceUrl,
    })
    .from(competition)
    .leftJoin(competitionProfile, eq(competitionProfile.competitionId, competition.id))
    .leftJoin(asset, eq(asset.id, competition.logoAssetId))
    .where(inArray(competition.id, [...new Set(ids)]));
  const out = new Map<string, { ref: PersonSeasonStats['competition']; tier: number }>();
  for (const r of rows) {
    if (out.has(r.id)) continue;
    const labels = { ...(r.labels ?? {}), ...(r.profileLabels ?? {}) } as Record<string, string>;
    out.set(r.id, {
      ref: {
        id: r.id,
        slug: r.slug,
        name: pickText(labels, locale, r.name)!,
        logo: assetUrl(assetsBaseUrl, r.logoKey, r.logoUrl),
      },
      tier: r.tier,
    });
  }
  return out;
}

/** Foto da pessoa no espelho: tipo (`player` ou `coach`) e se já está no nosso storage. */
async function photoAsset(db: Database, id: string) {
  const [row] = await db
    .select({ kind: asset.kind, storageKey: asset.storageKey })
    .from(personTable)
    .innerJoin(asset, eq(asset.id, personTable.photoAssetId))
    .where(eq(personTable.id, id))
    .limit(1);
  return row ?? null;
}

const isoDate = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Afastamentos mostrados no perfil. */
const SIDELINED = 10;

/**
 * Perfil do jogador (`GET /v1/people/{id}/overview`): pessoa, time atual com as cores do escudo, números da
 * temporada por competição, carreira por clube, transferências, títulos, afastamentos e últimos jogos — tudo
 * do core e do `raw`, sem chamar o fornecedor.
 *
 * Os números vêm de duas fontes: o total da temporada do fornecedor (`core.person_season_stat`, de
 * `players?league&season`) e a soma das estatísticas por partida (`detail.players`). Por competição vale o
 * do fornecedor; a soma das partidas cobre as temporadas que ele ainda não trouxe. As partidas vêm dos times
 * da pessoa (elencos, números por temporada, transferências e lances).
 */
export async function loadPersonOverview(
  bctx: BuildContext,
  id: string,
  year: number | undefined,
): Promise<{ body: PersonOverview; teamIds: string[]; eventIds: string[] }> {
  const { db, assetsBaseUrl, locale } = bctx;
  const person = await loadPerson(db, assetsBaseUrl, bctx.now, id);
  const [nationality, photo, seasonRows, transferRows, trophies, sidelined] = await Promise.all([
    nationalityResolver(db, locale),
    photoAsset(db, id),
    personSeasonRows(db, id),
    personTransferRows(db, id),
    personTrophyRows(db, id),
    personSidelinedRows(db, id, SIDELINED),
  ]);
  const pid = person.external_ids['api-sports'] ?? null;
  const rosterTeamIds = [...new Set(person.teams.map((t) => t.team.id))];

  // transferências: as normalizadas (`person_transfer`); sem elas, as listas `transfers?team` do raw
  const rawTransfers =
    pid && !transferRows.length
      ? await playerTransfers(db, pid, [...(await providerIds(db, 'participant', rosterTeamIds)).values()])
      : [];
  const rawTransferTeams = await coreIds(
    db,
    'participant',
    rawTransfers.flatMap((t) =>
      [t.teams?.in?.id, t.teams?.out?.id].filter((x): x is number => typeof x === 'number').map(String),
    ),
  );
  const transferTeamIds = [
    ...transferRows.flatMap((t) => [t.fromId, t.toId]).filter((x): x is string => !!x),
    ...rawTransferTeams.values(),
  ];
  const incidents = await incidentTeams(db, person.id);
  const candidates = [
    ...new Set([
      ...rosterTeamIds,
      ...seasonRows.map((r) => r.participantId),
      ...transferTeamIds,
      ...incidents,
    ]),
  ];

  // técnico: pelo elenco ou pela foto (`coachs/`). Os IDs de técnico e de jogador da api-sports são
  // espaços diferentes, mas o core os grava na mesma pessoa: um técnico com o ID de um jogador herdaria os
  // jogos dele, então para quem tem cara de técnico as escalações vêm primeiro.
  const coachHint =
    (person.teams.length > 0 && person.teams.every((t) => t.role !== 'player')) || photo?.kind === 'coach';
  const coached = async () => {
    if (!pid) return [];
    const career = await coreIds(db, 'participant', await coachCareerTeams(db, pid));
    return coachLines(db, pid, [...new Set([...rosterTeamIds, ...career.values()])]);
  };
  let raw = coachHint ? await coached() : [];
  let isCoach = raw.length > 0 || coachHint;
  if (!isCoach && pid) {
    raw = await playerLines(db, pid, candidates);
    if (!raw.length && !seasonRows.length) {
      raw = await coached();
      isCoach = raw.length > 0;
    }
  }
  const lineTeams = await coreIds(
    db,
    'participant',
    raw.map((l) => l.team_pid),
  );
  const lines: Line[] = raw.map((l) => ({
    ...l,
    // técnico: cada escalação conta como jogo (sem números individuais)
    n: isCoach ? { ...matchNumbers(null), played: true } : matchNumbers(l.stat),
    teamId: lineTeams.get(l.team_pid) ?? null,
  }));
  // os números do fornecedor são de jogador: num técnico (IDs colididos) seriam de outra pessoa
  const providerRows = isCoach ? [] : seasonRows;

  // números por ano, competição e time: o do fornecedor ou a soma das partidas
  type Group = {
    year: number;
    label: string;
    competitionId: string;
    teamId: string;
    lines: Line[];
    provider: SummedNumbers | null;
  };
  const groups = new Map<string, Group>();
  const group = (y: number, label: string, competitionId: string, teamId: string) => {
    const key = `${y}|${competitionId}|${teamId}`;
    const g = groups.get(key) ?? { year: y, label, competitionId, teamId, lines: [], provider: null };
    groups.set(key, g);
    return g;
  };
  for (const l of lines)
    if (l.year !== null && l.competition_id && l.teamId)
      group(l.year, l.season_label ?? String(l.year), l.competition_id, l.teamId).lines.push(l);
  for (const r of providerRows)
    group(r.year, r.label, r.competitionId, r.participantId).provider = providerNumbers(r);
  const merged = [...groups.values()]
    .map((g) => ({
      g,
      pick: pickNumbers(g.provider, g.lines.length ? sumNumbers(g.lines.map((l) => l.n)) : null),
    }))
    .filter((x): x is { g: Group; pick: NonNullable<ReturnType<typeof pickNumbers>> } => x.pick !== null);

  // anos: com jogos ou com inscrição no elenco
  const years = new Set<number>([
    ...merged.map((m) => m.g.year),
    ...lines.map((l) => l.year).filter((y): y is number => y !== null),
    ...providerRows.map((r) => r.year),
  ]);
  for (const t of person.teams) if (t.season !== null) years.add(t.season);
  const yearTotals = (y: number) =>
    addNumbers(merged.filter((m) => m.g.year === y).map((m) => m.pick.numbers));
  const seasons = [...years]
    .sort((a, b) => b - a)
    .map((y) => {
      const s = yearTotals(y);
      return { year: y, appearances: s.appearances, goals: s.goals };
    });
  const shown = year ?? seasons.find((s) => s.appearances > 0)?.year ?? seasons[0]?.year ?? null;
  const inYear = shown === null ? [] : lines.filter((l) => l.year === shown);

  const teams = await participantRefs(db, assetsBaseUrl, [
    ...candidates,
    ...lines.map((l) => l.teamId).filter((x): x is string => !!x),
  ]);
  const shownGroups = merged.filter((m) => m.g.year === shown);
  const comps = await competitionRefs(
    db,
    assetsBaseUrl,
    locale,
    shownGroups.map((m) => m.g.competitionId),
  );

  // números da temporada por competição (e time, se ele trocou de clube no ano)
  const stats: PersonSeasonStats[] = [];
  for (const { g, pick } of shownGroups) {
    const comp = comps.get(g.competitionId);
    const team = teams.get(g.teamId);
    if (!comp || !team) continue;
    stats.push({
      ...pick.numbers,
      competition: comp.ref,
      season: { year: g.year, label: g.label },
      team: team.ref,
      source: pick.source,
    });
  }
  stats.sort(
    (a, b) =>
      (comps.get(a.competition.id)?.tier ?? 9) - (comps.get(b.competition.id)?.tier ?? 9) ||
      b.appearances - a.appearances,
  );
  const totalsSum = addNumbers(stats);
  const totals = totalsSum.appearances ? totalsSum : null;

  // carreira: por clube, os anos com jogo ou inscrição
  const current = person.teams.filter((t) => t.season === null);
  const careerOf = new Map<string, { years: Set<number>; numbers: SummedNumbers[] }>();
  const careerEntry = (teamId: string) => {
    const c = careerOf.get(teamId) ?? { years: new Set<number>(), numbers: [] };
    careerOf.set(teamId, c);
    return c;
  };
  for (const { g, pick } of merged) {
    const c = careerEntry(g.teamId);
    c.years.add(g.year);
    c.numbers.push(pick.numbers);
  }
  for (const t of person.teams) if (t.season !== null) careerEntry(t.team.id).years.add(t.season);
  const career: PersonOverview['career'] = [];
  for (const [teamId, c] of careerOf) {
    const team = teams.get(teamId) ?? null;
    if (!team || !c.years.size) continue;
    const ys = [...c.years].sort((a, b) => a - b);
    const sum = addNumbers(c.numbers);
    career.push({
      team: team.ref,
      from: ys[0]!,
      to: ys.at(-1)!,
      seasons: ys,
      appearances: sum.appearances,
      goals: sum.goals,
      current: current.some((t) => t.team.id === teamId),
    });
  }
  // elenco atual sem jogo nem inscrição por temporada (contratação recente): entra sem anos de jogo
  for (const t of current) {
    if (career.some((c) => c.team.id === t.team.id)) continue;
    const y = seasons[0]?.year ?? bctx.now.getUTCFullYear();
    career.push({ team: t.team, from: y, to: y, seasons: [], appearances: 0, goals: 0, current: true });
  }
  career.sort((a, b) => Number(b.current) - Number(a.current) || b.to - a.to || b.from - a.from);

  // time atual: o do elenco atual; sem ele, o do jogo mais recente ou o da temporada mais recente
  const currentRoster = current.find((t) => t.role === 'player') ?? current[0] ?? null;
  const latestProvider = [...providerRows].sort((a, b) => b.year - a.year)[0];
  const currentTeamId =
    currentRoster?.team.id ??
    lines.find((l) => l.n.played && l.teamId)?.teamId ??
    latestProvider?.participantId ??
    null;
  const currentTeam = currentTeamId ? (teams.get(currentTeamId) ?? null) : null;
  const latestRoster = currentRoster ?? person.teams[0] ?? null;

  // últimos jogos da temporada em que entrou em campo
  const recent = inYear.filter((l) => l.n.played).slice(0, RECENT_MATCHES);
  const built = await buildEvents(
    bctx,
    recent.map((l) => l.event_id),
  );
  const byId = new Map(built.map((b) => [b.dto.id, b.dto]));
  const recentMatches: PersonMatch[] = [];
  for (const l of recent) {
    const ev = byId.get(l.event_id);
    if (!ev) continue;
    recentMatches.push({
      event: ev,
      team_id: l.teamId,
      started: l.n.started,
      minutes: isCoach ? null : l.n.minutes,
      rating: l.n.rating,
      goals: l.n.goals,
      assists: l.n.assists,
      yellow_cards: l.n.yellow_cards,
      red_cards: l.n.red_cards,
    });
  }

  const knownTeam = (
    teamId: string | null,
    name: string | null | undefined,
    logo: string | null | undefined,
  ) => {
    const known = teamId ? teams.get(teamId) : undefined;
    return {
      id: known ? teamId : null,
      name: known?.ref.name ?? name ?? '',
      logo: known?.ref.logo ?? logo ?? null,
    };
  };
  const transfers: PersonOverview['transfers'] = transferRows.length
    ? transferRows.map((t) => ({
        date: t.date,
        type: t.type && t.type !== 'N/A' ? t.type : null,
        from: knownTeam(t.fromId, t.fromName, null),
        to: knownTeam(t.toId, t.toName, null),
      }))
    : rawTransfers
        .filter((t) => t.teams?.in || t.teams?.out)
        .map((t) => ({
          date: isoDate(t.date),
          type: t.type && t.type !== 'N/A' ? t.type : null,
          from: knownTeam(
            t.teams?.out?.id != null ? (rawTransferTeams.get(String(t.teams.out.id)) ?? null) : null,
            t.teams?.out?.name,
            t.teams?.out?.logo,
          ),
          to: knownTeam(
            t.teams?.in?.id != null ? (rawTransferTeams.get(String(t.teams.in.id)) ?? null) : null,
            t.teams?.in?.name,
            t.teams?.in?.logo,
          ),
        }));

  const playerLinesOnly = lines.filter((l) => l.n.played);
  const body: PersonOverview = {
    person,
    nationality_ref: nationality(person.nationality),
    role:
      latestRoster?.role ??
      (isCoach ? 'coach' : playerLinesOnly.length || providerRows.length ? 'player' : null),
    position:
      latestRoster?.position ??
      latestProvider?.position ??
      (isCoach ? null : mostCommon(playerLinesOnly.slice(0, 40).map((l) => l.n.position))),
    number:
      latestRoster?.number ??
      playerLinesOnly.find((l) => l.n.number !== null)?.n.number ??
      latestProvider?.number ??
      null,
    current_team: currentTeam ? { ...currentTeam.ref, colors: teamColors(currentTeam.palette) } : null,
    season: shown ?? null,
    seasons,
    totals,
    stats,
    career,
    transfers,
    // títulos e afastamentos são de jogador: num técnico com ID colidido seriam de outra pessoa
    trophies: isCoach ? [] : trophies.map((t) => ({ ...t, season: t.season! })),
    sidelined: isCoach ? [] : sidelined,
    media: person.photo
      ? [{ kind: 'photo', url: person.photo, mirrored: !!(photo?.storageKey && assetsBaseUrl) }]
      : [],
    recent_matches: recentMatches,
  };
  return { body, teamIds: [...teams.keys()], eventIds: recentMatches.map((m) => m.event.id) };
}
