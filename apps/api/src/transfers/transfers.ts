/**
 * Vai e vem do mercado (#832): transferências de um time ou dos times de um campeonato, lidas de
 * `core.person_transfer` (normalizadas do `transfers` da api-sports).
 */
import { and, desc, eq, gte, inArray, or, sql, type SQL } from 'drizzle-orm';
import { transferKind, type Transfer, type TransferDirection, type TransferList } from '@galaxie/contracts';
import {
  asset,
  competition,
  competitionProfile,
  event,
  eventParticipant,
  participant,
  personTransfer,
  season,
  type Database,
} from '@galaxie/db';
import { competitionLogoId, teamLogoId } from '../assets/custom-logos.js';
import { competitionProfileJoin } from '../competitions/profile.js';
import type { ReviewStatus } from '../context.js';
import { problems } from '../errors.js';
import { competitionName } from '../i18n.js';
import { selectPeople } from '../people/person.js';
import { loadTeamNames, type TeamNameOptions } from '../teams/display-name.js';
import { assetUrl, UUID_RE } from '../util.js';

const DAY_MS = 86_400_000;

export interface TransfersOptions {
  direction: TransferDirection;
  days: number;
  limit: number;
  now: Date;
  assetsBaseUrl: string | undefined;
  customLogos: boolean;
  names: TeamNameOptions;
  minReview: ReviewStatus;
}

/** Uma linha de `core.person_transfer`. */
export interface TransferRow {
  personId: string;
  date: string | null;
  type: string | null;
  fromId: string | null;
  toId: string | null;
  fromName: string | null;
  toName: string | null;
}

interface ClubRef {
  name: string;
  logo: string | null;
}

/** Primeiro dia do período (`days` para trás a partir de hoje, UTC). */
export function sinceDate(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Condição das linhas que envolvem os times do recorte, pela direção: `in` = chegou a um deles, `out` =
 * saiu de um deles, `all` = qualquer um dos dois.
 */
function directionCond(teams: string[], direction: TransferDirection): SQL | undefined {
  const toIn = inArray(personTransfer.toParticipantId, teams);
  const fromIn = inArray(personTransfer.fromParticipantId, teams);
  return direction === 'in' ? toIn : direction === 'out' ? fromIn : or(toIn, fromIn);
}

/**
 * Linhas → resposta. A direção é a do recorte: com `out` pedido, tudo é saída; senão, chegou a um time do
 * recorte = `in` (uma troca entre dois times do mesmo campeonato conta como chegada). Clube fora do
 * catálogo sai com `id` nulo e o nome do fornecedor; pessoa sem cadastro fica de fora.
 */
export function shapeTransfers(
  rows: TransferRow[],
  input: {
    teams: ReadonlySet<string>;
    direction: TransferDirection;
    people: ReadonlyMap<string, { name: string; photo: string | null }>;
    clubs: ReadonlyMap<string, ClubRef>;
    limit: number;
  },
): Transfer[] {
  const club = (id: string | null, name: string | null) => {
    const known = id ? input.clubs.get(id) : undefined;
    return { id: known ? id : null, name: known?.name ?? name ?? '', logo: known?.logo ?? null };
  };
  const out: Transfer[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const person = input.people.get(r.personId);
    if (!person) continue;
    const arrived = !!r.toId && input.teams.has(r.toId);
    const left = !!r.fromId && input.teams.has(r.fromId);
    if (!arrived && !left) continue;
    if (input.direction === 'in' && !arrived) continue;
    if (input.direction === 'out' && !left) continue;
    const direction = input.direction === 'out' ? 'out' : arrived ? 'in' : 'out';
    // a mesma mudança escrita duas vezes pelo fornecedor ("Loan" e "N/A" no mesmo dia)
    const key = `${r.personId}|${r.date}|${r.fromId ?? r.fromName}|${r.toId ?? r.toName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const raw = r.type && !/^n\/?a$/i.test(r.type.trim()) ? r.type.trim() : null;
    out.push({
      person: { id: r.personId, name: person.name, photo: person.photo },
      date: r.date,
      direction,
      ...transferKind(raw),
      type: raw,
      from: club(r.fromId, r.fromName),
      to: club(r.toId, r.toName),
    });
    if (out.length >= input.limit) break;
  }
  return out;
}

/**
 * Tags de cache da resposta: os times do recorte, os clubes do outro lado (nome e escudo vão no corpo) e
 * cada jogador listado (nome e foto), além de `roster`. A troca de qualquer um deles purga a resposta.
 */
export function transferTags(body: TransferList, teamIds: readonly string[]): string[] {
  const clubs = new Set(teamIds);
  const people = new Set<string>();
  for (const t of body.data) {
    if (t.from.id) clubs.add(t.from.id);
    if (t.to.id) clubs.add(t.to.id);
    people.add(t.person.id);
  }
  return [
    'roster',
    ...[...clubs].map((id) => `participant:${id}`),
    ...[...people].map((id) => `person:${id}`),
  ];
}

/** Transferências dos times no período, das mais recentes para trás (com folga para as repetidas). */
async function transferRows(db: Database, teams: string[], opts: TransfersOptions): Promise<TransferRow[]> {
  if (!teams.length) return [];
  return db
    .select({
      personId: personTransfer.personId,
      date: personTransfer.date,
      type: personTransfer.type,
      fromId: personTransfer.fromParticipantId,
      toId: personTransfer.toParticipantId,
      fromName: personTransfer.fromName,
      toName: personTransfer.toName,
    })
    .from(personTransfer)
    .where(
      and(directionCond(teams, opts.direction), gte(personTransfer.date, sinceDate(opts.now, opts.days))),
    )
    .orderBy(desc(personTransfer.date), desc(personTransfer.id))
    .limit(opts.limit * 2);
}

/** Nome exibido e escudo dos clubes. */
async function clubRefs(db: Database, ids: string[], opts: TransfersOptions): Promise<Map<string, ClubRef>> {
  const list = [...new Set(ids)];
  if (!list.length) return new Map();
  const rows = await db
    .select({
      id: participant.id,
      name: participant.name,
      logoKey: asset.storageKey,
      logoUrl: asset.sourceUrl,
    })
    .from(participant)
    .leftJoin(asset, eq(asset.id, teamLogoId(opts.customLogos)))
    .where(inArray(participant.id, list));
  const names = await loadTeamNames(
    db,
    rows.map((r) => r.id),
    opts.names,
  );
  return new Map(
    rows.map((r) => [
      r.id,
      { name: names.name(r.id, r.name), logo: assetUrl(opts.assetsBaseUrl, r.logoKey, r.logoUrl) },
    ]),
  );
}

async function build(
  db: Database,
  scope: TransferList['scope'],
  teams: string[],
  opts: TransfersOptions,
): Promise<TransferList> {
  const rows = await transferRows(db, teams, opts);
  const [persons, clubs] = await Promise.all([
    selectPeople(
      db,
      rows.map((r) => r.personId),
    ),
    clubRefs(
      db,
      rows.flatMap((r) => [r.fromId, r.toId]).filter((x): x is string => !!x),
      opts,
    ),
  ]);
  const people = new Map(
    persons.map((p) => [p.id, { name: p.name, photo: assetUrl(opts.assetsBaseUrl, p.photoKey, p.photoUrl) }]),
  );
  return {
    scope,
    since: sinceDate(opts.now, opts.days),
    data: shapeTransfers(rows, {
      teams: new Set(teams),
      direction: opts.direction,
      people,
      clubs,
      limit: opts.limit,
    }),
  };
}

/** `GET /v1/teams/{id}/transfers`. Devolve também o esporte (para o plano) e os ids para o cache. */
export async function loadTeamTransfers(db: Database, teamId: string, opts: TransfersOptions) {
  const [team] = await db
    .select({ id: participant.id, name: participant.name, sport: participant.sport })
    .from(participant)
    .where(eq(participant.id, teamId))
    .limit(1);
  if (!team) throw problems.notFound('Time');
  const ref = (await clubRefs(db, [team.id], opts)).get(team.id);
  const body = await build(
    db,
    { type: 'team', id: team.id, name: ref?.name ?? team.name, logo: ref?.logo ?? null },
    [team.id],
    opts,
  );
  return { body, sport: team.sport, teamIds: [team.id] };
}

/**
 * Times de um campeonato: os que jogam a temporada atual (ou a mais recente com jogos). Sem jogos na base,
 * nenhum time (lista vazia).
 */
async function competitionTeams(db: Database, competitionId: string): Promise<string[]> {
  const [current] = await db
    .select({ id: season.id })
    .from(season)
    .where(
      and(
        eq(season.competitionId, competitionId),
        sql`exists (select 1 from ${event} e where e.season_id = ${season.id})`,
      ),
    )
    .orderBy(desc(season.current), desc(season.year))
    .limit(1);
  if (!current) return [];
  const rows = await db
    .selectDistinct({ id: eventParticipant.participantId })
    .from(eventParticipant)
    .innerJoin(event, eq(event.id, eventParticipant.eventId))
    .where(eq(event.seasonId, current.id));
  return rows.map((r) => r.id);
}

/** `GET /v1/competitions/{id}/transfers` (UUID ou slug). */
export async function loadCompetitionTransfers(
  db: Database,
  idOrSlug: string,
  opts: TransfersOptions & { locale: string },
) {
  const [row] = await db
    .select({
      id: competition.id,
      name: competition.name,
      sport: competition.sport,
      labels: competition.labels,
      countryCode: competition.countryCode,
      profileLabels: competitionProfile.labels,
      logoKey: asset.storageKey,
      logoUrl: asset.sourceUrl,
    })
    .from(competition)
    .leftJoin(competitionProfile, competitionProfileJoin(opts.minReview))
    .leftJoin(asset, eq(asset.id, competitionLogoId(opts.customLogos)))
    .where(UUID_RE.test(idOrSlug) ? eq(competition.id, idOrSlug) : eq(competition.slug, idOrSlug))
    .orderBy(sql`(${competition.sport} = 'football') desc`)
    .limit(1);
  if (!row) throw problems.notFound('Competição');
  const labels = { ...(row.labels ?? {}), ...(row.profileLabels ?? {}) } as Record<string, string>;
  const teams = await competitionTeams(db, row.id);
  const body = await build(
    db,
    {
      type: 'competition',
      id: row.id,
      name: competitionName(labels, row.countryCode, row.name, opts.locale),
      logo: assetUrl(opts.assetsBaseUrl, row.logoKey, row.logoUrl),
    },
    teams,
    opts,
  );
  return { body, sport: row.sport, competitionId: row.id, teamIds: teams };
}
