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
  playerLines,
  playerTransfers,
  providerIds,
  type PlayerLine,
} from './queries.js';
import { matchNumbers, mostCommon, sumNumbers, type MatchNumbers } from './stats.js';

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

/**
 * Perfil do jogador (`GET /v1/people/{id}/overview`): pessoa, time atual com as cores do escudo, números da
 * temporada por competição, carreira por clube, transferências e últimos jogos — tudo do core e do `raw`,
 * sem chamar o fornecedor. As partidas vêm dos times que ele defendeu (elencos e transferências).
 */
export async function loadPersonOverview(
  bctx: BuildContext,
  id: string,
  year: number | undefined,
): Promise<{ body: PersonOverview; teamIds: string[]; eventIds: string[] }> {
  const { db, assetsBaseUrl, locale } = bctx;
  const person = await loadPerson(db, assetsBaseUrl, bctx.now, id);
  const [nationality, photo] = await Promise.all([nationalityResolver(db, locale), photoAsset(db, id)]);
  const pid = person.external_ids['api-sports'] ?? null;
  const rosterTeamIds = [...new Set(person.teams.map((t) => t.team.id))];
  const rosterPids = await providerIds(db, 'participant', rosterTeamIds);

  // transferências: as listas `transfers?team` dos clubes do elenco; os clubes delas também viram candidatos
  const transfers = pid ? await playerTransfers(db, pid, [...rosterPids.values()]) : [];
  const transferPids = transfers.flatMap((t) =>
    [t.teams?.in?.id, t.teams?.out?.id].filter((x): x is number => typeof x === 'number').map(String),
  );
  const [transferTeams, incidents] = await Promise.all([
    coreIds(db, 'participant', transferPids),
    incidentTeams(db, person.id),
  ]);
  const candidates = [...new Set([...rosterTeamIds, ...transferTeams.values(), ...incidents])];

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
    if (!raw.length) {
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

  // anos: com jogos (entrou em campo) ou com inscrição no elenco
  const byYear = new Map<number, Line[]>();
  for (const l of lines) if (l.year !== null) byYear.set(l.year, [...(byYear.get(l.year) ?? []), l]);
  const years = new Set<number>([...byYear.keys()]);
  for (const t of person.teams) if (t.season !== null) years.add(t.season);
  const seasons = [...years]
    .sort((a, b) => b - a)
    .map((y) => {
      const s = sumNumbers((byYear.get(y) ?? []).map((l) => l.n));
      return { year: y, appearances: s.appearances, goals: s.goals };
    });
  const shown = year ?? seasons.find((s) => s.appearances > 0)?.year ?? seasons[0]?.year ?? null;
  const inYear = shown === null ? [] : (byYear.get(shown) ?? []);

  const teams = await participantRefs(db, assetsBaseUrl, [
    ...candidates,
    ...lines.map((l) => l.teamId).filter((x): x is string => !!x),
  ]);
  const comps = await competitionRefs(
    db,
    assetsBaseUrl,
    locale,
    inYear.map((l) => l.competition_id).filter((x): x is string => !!x),
  );

  // números da temporada por competição (e time, se ele trocou de clube no ano)
  const groups = new Map<string, Line[]>();
  for (const l of inYear) {
    if (!l.competition_id || !l.teamId) continue;
    const key = `${l.competition_id}|${l.teamId}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const stats: PersonSeasonStats[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const comp = comps.get(first.competition_id!);
    const team = teams.get(first.teamId!);
    if (!comp || !team) continue;
    const sum = sumNumbers(group.map((l) => l.n));
    if (!sum.appearances) continue;
    stats.push({
      ...sum,
      competition: comp.ref,
      season: { year: first.year!, label: first.season_label ?? String(first.year) },
      team: team.ref,
    });
  }
  stats.sort(
    (a, b) =>
      (comps.get(a.competition.id)?.tier ?? 9) - (comps.get(b.competition.id)?.tier ?? 9) ||
      b.appearances - a.appearances,
  );
  const totalsSum = sumNumbers(inYear.map((l) => l.n));
  const totals = totalsSum.appearances ? totalsSum : null;

  // carreira: por clube, os anos com jogo ou inscrição
  const current = person.teams.filter((t) => t.season === null);
  const careerYears = new Map<string, { years: Set<number>; lines: Line[] }>();
  for (const l of lines) {
    if (!l.teamId || l.year === null || !l.n.played) continue;
    const c = careerYears.get(l.teamId) ?? { years: new Set(), lines: [] };
    c.years.add(l.year);
    c.lines.push(l);
    careerYears.set(l.teamId, c);
  }
  for (const t of person.teams) {
    if (t.season === null) continue;
    const c = careerYears.get(t.team.id) ?? { years: new Set(), lines: [] };
    c.years.add(t.season);
    careerYears.set(t.team.id, c);
  }
  const career: PersonOverview['career'] = [];
  for (const [teamId, c] of careerYears) {
    const team = teams.get(teamId) ?? null;
    if (!team || !c.years.size) continue;
    const ys = [...c.years].sort((a, b) => a - b);
    const sum = sumNumbers(c.lines.map((l) => l.n));
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

  // time atual: o do elenco atual; sem ele, o do jogo mais recente
  const currentRoster = current.find((t) => t.role === 'player') ?? current[0] ?? null;
  const currentTeamId = currentRoster?.team.id ?? lines.find((l) => l.n.played && l.teamId)?.teamId ?? null;
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

  const transferTeam = (
    t: { id?: number | null; name?: string | null; logo?: string | null } | null | undefined,
  ) => {
    const teamId = t?.id != null ? (transferTeams.get(String(t.id)) ?? null) : null;
    const known = teamId ? teams.get(teamId) : undefined;
    return {
      id: known ? teamId : null,
      name: known?.ref.name ?? t?.name ?? '',
      logo: known?.ref.logo ?? t?.logo ?? null,
    };
  };

  const playerLinesOnly = lines.filter((l) => l.n.played);
  const body: PersonOverview = {
    person,
    nationality_ref: nationality(person.nationality),
    role: latestRoster?.role ?? (isCoach ? 'coach' : playerLinesOnly.length ? 'player' : null),
    position:
      latestRoster?.position ??
      (isCoach ? null : mostCommon(playerLinesOnly.slice(0, 40).map((l) => l.n.position))),
    number: latestRoster?.number ?? playerLinesOnly.find((l) => l.n.number !== null)?.n.number ?? null,
    current_team: currentTeam ? { ...currentTeam.ref, colors: teamColors(currentTeam.palette) } : null,
    season: shown ?? null,
    seasons,
    totals,
    stats,
    career,
    transfers: transfers
      .filter((t) => t.teams?.in || t.teams?.out)
      .map((t) => ({
        date: isoDate(t.date),
        type: t.type && t.type !== 'N/A' ? t.type : null,
        from: transferTeam(t.teams?.out),
        to: transferTeam(t.teams?.in),
      })),
    media: person.photo
      ? [{ kind: 'photo', url: person.photo, mirrored: !!(photo?.storageKey && assetsBaseUrl) }]
      : [],
    recent_matches: recentMatches,
  };
  return { body, teamIds: [...teams.keys()], eventIds: recentMatches.map((m) => m.event.id) };
}
