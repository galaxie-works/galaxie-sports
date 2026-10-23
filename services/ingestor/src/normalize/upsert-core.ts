/**
 * Upsert idempotente de um lote normalizado (qualquer provedor) no schema `core`.
 *
 * - IDs estáveis: toda entidade é achada pelo `core.provider_map`; IDs novos são UUID v7.
 * - Idempotente: reprocessar o mesmo lote não muda nada (nem `updated_at`): cada upsert só toca a
 *   linha quando algum valor muda, e a máquina de estados ignora observações repetidas/antigas.
 * - Coalesce: `null` do provedor nunca apaga um valor conhecido.
 * - Transacional: o lote inteiro entra ou nada entra (advisory lock por provedor/esporte).
 */
import { and, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  asset,
  competition,
  country,
  event,
  eventIncident,
  eventParticipant,
  footballFixture,
  participant,
  person,
  personSeasonStat,
  personSidelined,
  personTransfer,
  personTrophy,
  roster,
  season,
  sportEventDetail,
  stage,
  standing,
  venue,
  type Database,
} from '@galaxie/db';
import {
  applyObservation,
  canOverride,
  DEFAULT_PRECEDENCE,
  initialState,
  isKnockoutStage,
  sameState,
  type AssetKind,
  type DerbyLookup,
  type MachineOptions,
  type NormalizedBatch,
  type NormalizedEvent,
  type PrecedencePolicy,
  type SeasonRef,
  type StageKind,
} from '@galaxie/providers';
import { createDerbyLookup } from '@galaxie/knowledge';
import { DETACHED_WHEN_MISSING_KINDS, MISSING_ASSET } from '../assets/placeholder-logos.js';
import { slugify } from '../catalog/football-catalog.js';
import { matchProvisional, PROVISIONAL_MATCH_MS, type ProvisionalCandidate } from '../provisional/match.js';
import { insertLogs, logRows, stateColumns, stateFromRow } from './event-state.js';
import {
  competitionRules,
  derbyIntensityOf,
  groupTies,
  importanceFromFacts,
  maxRounds,
  pairKey,
  rulesLegs,
  sameBreakdown,
  tieShape,
  totalRoundsOf,
  type TieMatch,
} from './importance-facts.js';
import {
  assignIds,
  chunks,
  coalesceUpdate,
  dedupeBy,
  linkIds,
  replaceUpdate,
  resolveIds,
  type Executor,
  type ProviderScope,
  type Tx,
} from './sql-helpers.js';
import { uuidv7 } from './uuid.js';

export interface UpsertOptions {
  precedence?: PrecedencePolicy;
  /**
   * Busca de clássico pelo par de participantes. Padrão: a base semântica já semeada no banco
   * (`createDerbyLookup` de `@galaxie/knowledge`), então todo evento gravado sai com `derby_id` e a
   * intensidade do clássico na importância. `false` desliga (preserva o clássico já gravado).
   */
  derbyLookup?: DerbyLookup | false;
  machine?: MachineOptions;
}

export interface UpsertStats {
  competitionsCreated: number;
  seasonsCreated: number;
  stages: number;
  venues: number;
  participants: number;
  persons: number;
  events: {
    inserted: number;
    updated: number;
    unchanged: number;
    matchedAcrossProviders: number;
    /** Jogos provisórios (curadoria) assumidos pelo jogo oficial deste lote. */
    provisionalMerged: number;
    skippedByPrecedence: number;
    ignored: Record<string, number>;
    transitions: number;
  };
  incidents: number;
  rosters: number;
  standings: number;
  /** Perfil completo: estatísticas por temporada, transferências, títulos e afastamentos. */
  seasonStats: number;
  transfers: number;
  trophies: number;
  sidelined: number;
  assets: number;
  /** Complementos aplicados (resultados/grid da F1, desfecho do MMA) e os que não acharam o evento. */
  supplements: { applied: number; missingEvent: number };
}

export function emptyStats(): UpsertStats {
  return {
    competitionsCreated: 0,
    seasonsCreated: 0,
    stages: 0,
    venues: 0,
    participants: 0,
    persons: 0,
    events: {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      matchedAcrossProviders: 0,
      provisionalMerged: 0,
      skippedByPrecedence: 0,
      ignored: {},
      transitions: 0,
    },
    incidents: 0,
    rosters: 0,
    standings: 0,
    seasonStats: 0,
    transfers: 0,
    trophies: 0,
    sidelined: 0,
    assets: 0,
    supplements: { applied: 0, missingEvent: 0 },
  };
}

/** Soma estatísticas de vários lotes (relatório do runner). */
export function addStats(a: UpsertStats, b: UpsertStats): UpsertStats {
  const ignored = { ...a.events.ignored };
  for (const [k, v] of Object.entries(b.events.ignored)) ignored[k] = (ignored[k] ?? 0) + v;
  return {
    competitionsCreated: a.competitionsCreated + b.competitionsCreated,
    seasonsCreated: a.seasonsCreated + b.seasonsCreated,
    stages: a.stages + b.stages,
    venues: a.venues + b.venues,
    participants: a.participants + b.participants,
    persons: a.persons + b.persons,
    events: {
      inserted: a.events.inserted + b.events.inserted,
      updated: a.events.updated + b.events.updated,
      unchanged: a.events.unchanged + b.events.unchanged,
      matchedAcrossProviders: a.events.matchedAcrossProviders + b.events.matchedAcrossProviders,
      provisionalMerged: a.events.provisionalMerged + b.events.provisionalMerged,
      skippedByPrecedence: a.events.skippedByPrecedence + b.events.skippedByPrecedence,
      ignored,
      transitions: a.events.transitions + b.events.transitions,
    },
    incidents: a.incidents + b.incidents,
    rosters: a.rosters + b.rosters,
    standings: a.standings + b.standings,
    seasonStats: a.seasonStats + b.seasonStats,
    transfers: a.transfers + b.transfers,
    trophies: a.trophies + b.trophies,
    sidelined: a.sidelined + b.sidelined,
    assets: a.assets + b.assets,
    supplements: {
      applied: a.supplements.applied + b.supplements.applied,
      missingEvent: a.supplements.missingEvent + b.supplements.missingEvent,
    },
  };
}

/** Tolerância para reconhecer o mesmo evento descrito por outro provedor. */
const CROSS_PROVIDER_MATCH_MS = 3 * 3_600_000;

// ─── referências (países, assets) ────────────────────────────────────────────────────────────────

class Refs {
  private countriesByName?: Map<string, string>;
  private countryCodes?: Set<string>;

  constructor(private readonly tx: Executor) {}

  async countryCode(code: string | null, name: string | null): Promise<string | null> {
    if (!this.countriesByName || !this.countryCodes) {
      const rows = await this.tx.select({ code: country.code, name: country.name }).from(country);
      this.countryCodes = new Set(rows.map((r) => r.code));
      this.countriesByName = new Map();
      for (const r of rows)
        for (const v of Object.values(r.name ?? {})) if (v) this.countriesByName.set(v.toLowerCase(), r.code);
    }
    if (code && this.countryCodes.has(code.toUpperCase())) return code.toUpperCase();
    if (name) return this.countriesByName.get(name.toLowerCase()) ?? null;
    return null;
  }

  /**
   * Registra URLs de mídia em `core.asset` (baixadas depois pelo Asset Mirror) e devolve url → id.
   * Foto de pessoa ou logo de time/competição já baixado que deu 404 ou imagem genérica fica de fora: a entidade
   * continua sem foto/logo.
   */
  async assets(items: { kind: AssetKind; url: string | null }[]): Promise<Map<string, string>> {
    const rows = dedupeBy(
      items.filter((i): i is { kind: AssetKind; url: string } => !!i.url),
      (i) => i.url,
    );
    const ids = new Map<string, string>();
    for (const chunk of chunks(rows, 500)) {
      await this.tx
        .insert(asset)
        .values(chunk.map((r) => ({ kind: r.kind, sourceUrl: r.url })))
        .onConflictDoNothing();
      const found = await this.tx
        .select({ id: asset.id, url: asset.sourceUrl, kind: asset.kind, missing: MISSING_ASSET })
        .from(asset)
        .where(
          inArray(
            asset.sourceUrl,
            chunk.map((r) => r.url),
          ),
        );
      for (const f of found)
        if (!(f.missing && DETACHED_WHEN_MISSING_KINDS.has(f.kind))) ids.set(f.url, f.id);
    }
    return ids;
  }
}

// ─── upsert do lote ──────────────────────────────────────────────────────────────────────────────

/** Grava um lote normalizado no core numa transação. */
export async function upsertBatch(
  db: Database,
  batch: NormalizedBatch,
  options: UpsertOptions = {},
): Promise<UpsertStats> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`normalize:${batch.provider}:${batch.sport}`}))`,
    );
    return upsertBatchInTx(tx, batch, options);
  });
}

export async function upsertBatchInTx(
  tx: Tx,
  batch: NormalizedBatch,
  options: UpsertOptions = {},
): Promise<UpsertStats> {
  const scope: ProviderScope = { provider: batch.provider, sport: batch.sport };
  const stats = emptyStats();
  const refs = new Refs(tx);

  // assets
  const assetIds = await refs.assets([
    ...batch.competitions.map((c) => ({ kind: 'league_logo' as const, url: c.logoUrl })),
    ...batch.venues.map((v) => ({ kind: 'venue' as const, url: v.imageUrl })),
    ...batch.participants.map((p) => ({ kind: p.logoKind ?? ('team_logo' as const), url: p.logoUrl })),
    ...batch.persons.map((p) => ({ kind: p.photoKind, url: p.photoUrl })),
  ]);
  stats.assets = assetIds.size;
  const assetId = (url: string | null) => (url ? (assetIds.get(url) ?? null) : null);

  // ─ competições e temporadas (garantir que existam; o catálogo é dono do tier/slug) ─
  const competitionRefs = new Set<string>([
    ...batch.competitions.map((c) => c.id),
    ...batch.events.flatMap((e) => (e.competitionId ? [e.competitionId] : [])),
    ...batch.standings.map((s) => s.season.competitionId),
    ...batch.rosters.flatMap((r) => (r.season ? [r.season.competitionId] : [])),
    ...batch.personSeasonStats.map((r) => r.season.competitionId),
    ...batch.stages.map((s) => s.season.competitionId),
  ]);
  const competitionIds = await resolveIds(tx, scope, 'competition', [...competitionRefs]);
  const toCreate = batch.competitions.filter((c) => !competitionIds.has(c.id));
  const createdLinks: { providerId: string; entityId: string }[] = [];
  for (const c of toCreate) {
    const id = uuidv7();
    const prefix = batch.provider === 'api-sports' ? '' : `${slugify(batch.provider)}-`;
    await tx.insert(competition).values({
      id,
      sport: batch.sport,
      slug: `${prefix}${slugify(c.countryName ?? 'world')}-${slugify(c.name)}-${slugify(c.id)}`,
      name: c.name,
      countryCode: await refs.countryCode(c.countryCode, c.countryName),
      type: c.type,
      logoAssetId: assetId(c.logoUrl),
    });
    competitionIds.set(c.id, id);
    createdLinks.push({ providerId: c.id, entityId: id });
  }
  await linkIds(tx, scope, 'competition', createdLinks);
  stats.competitionsCreated = createdLinks.length;

  const seasonRefs = new Map<
    string,
    {
      competitionId: string;
      year: number;
      label: string | null;
      startDate: string | null;
      endDate: string | null;
    }
  >();
  const addSeason = (
    ref: SeasonRef,
    extra?: { label: string | null; startDate: string | null; endDate: string | null },
  ) => {
    const compId = competitionIds.get(ref.competitionId);
    if (!compId) return;
    const key = `${compId}|${ref.year}`;
    const prev = seasonRefs.get(key);
    seasonRefs.set(key, {
      competitionId: compId,
      year: ref.year,
      label: extra?.label ?? prev?.label ?? null,
      startDate: extra?.startDate ?? prev?.startDate ?? null,
      endDate: extra?.endDate ?? prev?.endDate ?? null,
    });
  };
  for (const c of batch.competitions)
    for (const s of c.seasons) addSeason({ competitionId: c.id, year: s.year }, s);
  for (const e of batch.events) if (e.season) addSeason(e.season);
  for (const s of batch.standings) addSeason(s.season);
  for (const r of batch.rosters) if (r.season) addSeason(r.season);
  for (const r of batch.personSeasonStats) addSeason(r.season);
  for (const s of batch.stages) addSeason(s.season);

  const seasonIds = new Map<string, string>();
  const seasonValues = [...seasonRefs.values()];
  const compUuids = [...new Set(seasonValues.map((s) => s.competitionId))];
  const loadSeasons = async () => {
    for (const chunk of chunks(compUuids, 500)) {
      const rows = await tx
        .select({ id: season.id, competitionId: season.competitionId, year: season.year })
        .from(season)
        .where(inArray(season.competitionId, chunk));
      for (const r of rows) seasonIds.set(`${r.competitionId}|${r.year}`, r.id);
    }
  };
  await loadSeasons();
  const missingSeasons = seasonValues.filter((s) => !seasonIds.has(`${s.competitionId}|${s.year}`));
  for (const chunk of chunks(missingSeasons, 500)) {
    await tx
      .insert(season)
      .values(
        chunk.map((s) => ({
          competitionId: s.competitionId,
          year: s.year,
          label: s.label ?? String(s.year),
          startDate: s.startDate,
          endDate: s.endDate,
        })),
      )
      .onConflictDoNothing();
  }
  if (missingSeasons.length) await loadSeasons();
  // temporada que já existia sem datas (catálogo de API sem datas de temporada, ex.: F1): a janela vem dos
  // eventos e só cresce; as que não mudam nem são tocadas
  for (const s of seasonValues) {
    const id = seasonIds.get(`${s.competitionId}|${s.year}`);
    if (!id || (!s.startDate && !s.endDate) || missingSeasons.includes(s)) continue;
    const start = s.startDate ?? s.endDate!;
    const end = s.endDate ?? s.startDate!;
    await tx
      .update(season)
      .set({
        startDate: sql`least(${season.startDate}, ${start}::date)`,
        endDate: sql`greatest(${season.endDate}, ${end}::date)`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(season.id, id),
          sql`(${season.startDate} is null or ${season.startDate} > ${start}::date or ${season.endDate} is null or ${season.endDate} < ${end}::date)`,
        ),
      );
  }
  stats.seasonsCreated = missingSeasons.length;
  const seasonId = (ref: SeasonRef | null) => {
    if (!ref) return null;
    const comp = competitionIds.get(ref.competitionId);
    return comp ? (seasonIds.get(`${comp}|${ref.year}`) ?? null) : null;
  };

  // ─ fases ─
  const stageRows = dedupeBy(
    batch.stages.flatMap((s) => {
      const sid = seasonId(s.season);
      return sid
        ? [{ seasonId: sid, kind: s.kind, name: s.name, providerLabel: s.providerLabel, order: s.order }]
        : [];
    }),
    (s) => `${s.seasonId}|${s.providerLabel}`,
  );
  const stageIds = new Map<string, { id: string; kind: StageKind }>();
  for (const chunk of chunks(stageRows, 500)) {
    const { set, setWhere } = replaceUpdate(stage, ['kind', 'name', 'order']);
    await tx
      .insert(stage)
      .values(chunk)
      .onConflictDoUpdate({ target: [stage.seasonId, stage.providerLabel], set, setWhere });
  }
  for (const chunk of chunks([...new Set(stageRows.map((s) => s.seasonId))], 500)) {
    const rows = await tx
      .select({ id: stage.id, seasonId: stage.seasonId, label: stage.providerLabel, kind: stage.kind })
      .from(stage)
      .where(inArray(stage.seasonId, chunk));
    for (const r of rows) stageIds.set(`${r.seasonId}|${r.label}`, { id: r.id, kind: r.kind as StageKind });
  }
  stats.stages = stageRows.length;

  // ─ estádios ─
  const venues = dedupeBy(batch.venues, (v) => v.id);
  const venueIds = await assignIds(
    tx,
    scope,
    'venue',
    venues.map((v) => v.id),
  );
  const venueRows: (typeof venue.$inferInsert & { reference: boolean })[] = [];
  for (const v of venues)
    venueRows.push({
      reference: !!v.reference,
      id: venueIds.ids.get(v.id)!,
      name: v.name,
      city: v.city,
      countryCode: await refs.countryCode(v.countryCode, v.countryName),
      capacity: v.capacity,
      surface: v.surface,
      imageAssetId: assetId(v.imageUrl),
      nameSeenAt: v.nameSeenAt ?? null,
    });
  for (const reference of [false, true]) {
    const rows = venueRows.filter((r) => r.reference === reference).map(({ reference: _r, ...row }) => row);
    for (const chunk of chunks(rows, 500)) {
      const { set, setWhere } = coalesceUpdate(
        venue,
        ['city', 'countryCode', 'capacity', 'surface', 'imageAssetId'],
        { touchUpdatedAt: true, fillOnly: reference },
      );
      // Nome: o do jogo mais recente vence (cada partida traz o nome do dia); o de /teams, sem data,
      // só substitui um nome também sem data — fica para trás depois de uma venda de naming rights.
      const name = sql`case
        when excluded.name_seen_at is not null
             and (${venue.nameSeenAt} is null or excluded.name_seen_at >= ${venue.nameSeenAt}) then excluded.name
        when excluded.name_seen_at is null and ${venue.nameSeenAt} is null and ${sql.raw(String(!reference))} then excluded.name
        else ${venue.name} end`;
      const seenAt = sql`greatest(${venue.nameSeenAt}, excluded.name_seen_at)`;
      await tx
        .insert(venue)
        .values(chunk)
        .onConflictDoUpdate({
          target: venue.id,
          set: { ...set, name, nameSeenAt: seenAt },
          setWhere: sql`${setWhere} or (${venue.name}, ${venue.nameSeenAt}) is distinct from (${name}, ${seenAt})`,
        });
    }
  }
  await linkIds(
    tx,
    scope,
    'venue',
    [...venueIds.created].map((pid) => ({ providerId: pid, entityId: venueIds.ids.get(pid)! })),
  );
  stats.venues = venueRows.length;
  const venueId = (pid: string | null) => (pid ? (venueIds.ids.get(pid) ?? null) : null);

  // ─ participantes ─
  const participants = dedupeBy(batch.participants, (p) => p.id);
  const participantIds = await assignIds(
    tx,
    scope,
    'participant',
    participants.map((p) => p.id),
  );
  const participantRows: { known: boolean; reference: boolean; row: typeof participant.$inferInsert }[] = [];
  for (const p of participants)
    participantRows.push({
      known: p.kind != null,
      reference: !!p.reference,
      row: {
        id: participantIds.ids.get(p.id)!,
        sport: batch.sport,
        // tipo desconhecido entra como clube e não sobrescreve um tipo já conhecido
        kind: p.kind ?? 'club',
        name: p.name,
        shortName: p.shortName,
        code: p.code,
        countryCode: await refs.countryCode(p.countryCode, p.countryName),
        founded: p.founded,
        homeVenueId: venueId(p.venueId),
        logoAssetId: assetId(p.logoUrl),
      },
    });
  const participantKeys = [
    'name',
    'shortName',
    'code',
    'countryCode',
    'founded',
    'homeVenueId',
    'logoAssetId',
  ];
  for (const known of [true, false])
    for (const reference of [false, true]) {
      const rows = participantRows
        .filter((r) => r.known === known && r.reference === reference)
        .map((r) => r.row);
      for (const chunk of chunks(rows, 500)) {
        const { set, setWhere } = coalesceUpdate(
          participant,
          known ? ['kind', ...participantKeys] : participantKeys,
          { touchUpdatedAt: true, fillOnly: reference },
        );
        await tx
          .insert(participant)
          .values(chunk)
          .onConflictDoUpdate({ target: participant.id, set, setWhere });
      }
    }
  await linkIds(
    tx,
    scope,
    'participant',
    [...participantIds.created].map((pid) => ({ providerId: pid, entityId: participantIds.ids.get(pid)! })),
  );
  stats.participants = participantRows.length;
  const participantId = (pid: string | null) => (pid ? (participantIds.ids.get(pid) ?? null) : null);

  // ─ pessoas ─
  const persons = dedupeBy(batch.persons, (p) => p.id);
  const personIds = await assignIds(
    tx,
    scope,
    'person',
    persons.map((p) => p.id),
  );
  const personRows = persons.map((p) => ({
    reference: !!p.reference,
    id: personIds.ids.get(p.id)!,
    name: p.name,
    firstName: p.firstName,
    lastName: p.lastName,
    birthDate: p.birthDate,
    nationality: p.nationality,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    birthPlace: p.birthPlace ?? null,
    birthCountry: p.birthCountry ?? null,
    photoAssetId: assetId(p.photoUrl),
  }));
  for (const reference of [false, true]) {
    const rows = personRows.filter((r) => r.reference === reference).map(({ reference: _r, ...row }) => row);
    for (const chunk of chunks(rows, 500)) {
      const { set, setWhere } = coalesceUpdate(
        person,
        [
          'name',
          'firstName',
          'lastName',
          'birthDate',
          'nationality',
          'heightCm',
          'weightKg',
          'birthPlace',
          'birthCountry',
          'photoAssetId',
        ],
        { touchUpdatedAt: true, fillOnly: reference },
      );
      await tx.insert(person).values(chunk).onConflictDoUpdate({ target: person.id, set, setWhere });
    }
  }
  await linkIds(
    tx,
    scope,
    'person',
    [...personIds.created].map((pid) => ({ providerId: pid, entityId: personIds.ids.get(pid)! })),
  );
  stats.persons = personRows.length;
  const personId = (pid: string | null) => (pid ? (personIds.ids.get(pid) ?? null) : null);

  // ─ eventos ─
  const allowedEvents = await upsertEvents(tx, batch, scope, options, stats, {
    competitionIds,
    seasonId,
    stageIds,
    venueId,
    participantId,
  });

  // ─ participantes do evento (só com estado aplicado: lista mais antiga não reescreve) ─
  const canonicalEvents = allowedEvents.filter((e) => e.canonical);
  const appliedEvents = canonicalEvents.filter((e) => e.stateApplied);
  const epRows = dedupeBy(
    appliedEvents.flatMap(({ id, source }) =>
      source.participants.flatMap((p) => {
        const pid = participantId(p.participantId);
        return pid
          ? [{ eventId: id, participantId: pid, side: p.side, position: p.position, result: p.result }]
          : [];
      }),
    ),
    (r) => `${r.eventId}|${r.participantId}`,
  );
  for (const chunk of chunks(epRows, 500)) {
    const { set, setWhere } = replaceUpdate(eventParticipant, ['side', 'position', 'result']);
    await tx
      .insert(eventParticipant)
      .values(chunk)
      .onConflictDoUpdate({
        target: [eventParticipant.eventId, eventParticipant.participantId],
        set,
        setWhere,
      });
  }
  for (const { id, source } of appliedEvents) {
    const keep = source.participants.flatMap((p) => participantId(p.participantId) ?? []);
    if (!keep.length) continue;
    await tx
      .delete(eventParticipant)
      .where(and(eq(eventParticipant.eventId, id), notInArray(eventParticipant.participantId, keep)));
  }

  // ─ timeline: vale a do detalhe mais recente (mesmo que a lista de partidas seja mais nova) ─
  const withIncidents = canonicalEvents.filter((e) => e.source.incidents);
  const detailAt = new Map<string, Date | null>();
  for (const chunk of chunks(
    withIncidents.map((e) => e.id),
    500,
  )) {
    const rows = await tx
      .select({ eventId: footballFixture.eventId, at: footballFixture.detailFetchedAt })
      .from(footballFixture)
      .where(inArray(footballFixture.eventId, chunk));
    for (const r of rows) detailAt.set(r.eventId, r.at);
  }
  for (const { id, source, stateApplied } of withIncidents) {
    const known = detailAt.get(id);
    if (!stateApplied && known && known.getTime() > batch.observedAt.getTime()) continue;
    const rows = source.incidents!.map((i) => ({
      id: uuidv7(),
      eventId: id,
      sequence: i.sequence,
      minute: i.minute,
      extra: i.extra,
      type: i.type,
      detail: i.detail,
      participantId: participantId(i.participantId),
      personId: personId(i.personId),
      assistPersonId: personId(i.assistPersonId),
      data: i.data,
    }));
    for (const chunk of chunks(rows, 500)) {
      const { set, setWhere } = replaceUpdate(eventIncident, [
        'minute',
        'extra',
        'type',
        'detail',
        'participantId',
        'personId',
        'assistPersonId',
        'data',
      ]);
      await tx
        .insert(eventIncident)
        .values(chunk)
        .onConflictDoUpdate({ target: [eventIncident.eventId, eventIncident.sequence], set, setWhere });
    }
    // a timeline do provedor é a verdade: itens que sumiram (ex.: lance removido) saem
    await tx
      .delete(eventIncident)
      .where(and(eq(eventIncident.eventId, id), sql`${eventIncident.sequence} >= ${rows.length}`));
    stats.incidents += rows.length;
  }

  // ─ espelho da partida de futebol ─
  // Resumo (fixture/league/teams/goals/score) acompanha o estado aplicado; o detalhe parcial
  // (ex.: só eventos do ao vivo) é mesclado ao existente quando não é mais antigo.
  const ff = footballFixture;
  const detail = sql`case
    when excluded.detail is null then ${ff.detail}
    when ${ff.detailFetchedAt} is not null and excluded.detail_fetched_at < ${ff.detailFetchedAt} then ${ff.detail}
    else coalesce(${ff.detail}, '{}'::jsonb) || excluded.detail end`;
  const detailFetchedAt = sql`greatest(excluded.detail_fetched_at, ${ff.detailFetchedAt})`;
  for (const applied of [true, false]) {
    const mirrors = allowedEvents.filter((e) => e.source.footballFixture && e.stateApplied === applied);
    const pick = (column: SQL, value: SQL) => (applied ? value : column);
    const next = {
      providerFixtureId: pick(sql`${ff.providerFixtureId}`, sql`excluded.provider_fixture_id`),
      round: pick(sql`${ff.round}`, sql`excluded.round`),
      referee: pick(sql`${ff.referee}`, sql`coalesce(excluded.referee, ${ff.referee})`),
      summary: pick(sql`${ff.summary}`, sql`excluded.summary`),
    };
    for (const chunk of chunks(mirrors, 200)) {
      await tx
        .insert(ff)
        .values(
          chunk.map(({ id, source }) => {
            const m = source.footballFixture!;
            return {
              eventId: id,
              providerFixtureId: m.providerFixtureId,
              round: m.round,
              referee: m.referee,
              summary: m.summary,
              detail: m.detail,
              detailFetchedAt: m.detail ? batch.observedAt : null,
            };
          }),
        )
        .onConflictDoUpdate({
          target: ff.eventId,
          set: { ...next, detail, detailFetchedAt, updatedAt: sql`now()` },
          setWhere: sql`(${ff.providerFixtureId}, ${ff.round}, ${ff.referee}, ${ff.summary}, ${ff.detail}, ${ff.detailFetchedAt})
            is distinct from (${next.providerFixtureId}, ${next.round}, ${next.referee}, ${next.summary}, ${detail}, ${detailFetchedAt})`,
        });
    }
  }

  // ─ espelho dos demais esportes (jogo, corrida, luta) ─
  await upsertSportMirrors(tx, batch, allowedEvents);

  // ─ complementos de eventos já conhecidos (F1 resultados/grid, MMA desfecho) ─
  await upsertSupplements(tx, batch, scope, stats, participantId);

  // ─ elencos ─
  // time citado só pelo elenco (NBA v2: players?team&season não repete o time): vem do provider_map
  const rosterTeams = await resolveIds(
    tx,
    scope,
    'participant',
    batch.rosters.map((r) => r.participantId).filter((pid) => !participantIds.ids.has(pid)),
  );
  const rosterRows = dedupeBy(
    batch.rosters.flatMap((r) => {
      const pid = participantId(r.participantId) ?? rosterTeams.get(r.participantId) ?? null;
      const person = personId(r.personId);
      if (!pid || !person) return [];
      const sid = r.season ? seasonId(r.season) : null;
      if (r.season && !sid) return [];
      return [
        {
          participantId: pid,
          personId: person,
          seasonId: sid,
          role: r.role,
          number: r.number,
          position: r.position,
          validFrom: r.validFrom,
          validTo: r.validTo,
        },
      ];
    }),
    (r) => `${r.participantId}|${r.personId}|${r.role}|${r.seasonId ?? ''}`,
  );
  for (const chunk of chunks(rosterRows, 500)) {
    const { set, setWhere } = coalesceUpdate(roster, ['number', 'position', 'validFrom', 'validTo']);
    await tx
      .insert(roster)
      .values(chunk)
      .onConflictDoUpdate({
        target: [roster.participantId, roster.personId, roster.role, roster.seasonId],
        set,
        setWhere,
      });
  }
  for (const snap of dedupeBy(batch.rosterSnapshots, (s) => `${s.participantId}|${s.role}`)) {
    const pid = participantId(snap.participantId);
    if (!pid) continue;
    const keep = rosterRows
      .filter((r) => r.participantId === pid && r.role === snap.role && r.seasonId == null)
      .map((r) => r.personId);
    const conditions = [
      eq(roster.participantId, pid),
      eq(roster.role, snap.role),
      sql`${roster.seasonId} is null`,
    ];
    if (keep.length) conditions.push(notInArray(roster.personId, keep));
    await tx.delete(roster).where(and(...conditions));
  }
  stats.rosters = rosterRows.length;

  // ─ classificação ─
  const standingRows = dedupeBy(
    batch.standings.flatMap((s) => {
      const sid = seasonId(s.season);
      const pid = participantId(s.participantId);
      if (!sid || !pid) return [];
      return [
        {
          seasonId: sid,
          group: s.group,
          participantId: pid,
          rank: s.rank,
          points: s.points,
          played: s.played,
          won: s.won,
          drawn: s.drawn,
          lost: s.lost,
          otWon: s.otWon ?? null,
          otLost: s.otLost ?? null,
          goalsFor: s.goalsFor,
          goalsAgainst: s.goalsAgainst,
          form: s.form,
          description: s.description,
          source: 'provider',
        },
      ];
    }),
    (s) => `${s.seasonId}|${s.group}|${s.participantId}`,
  );
  for (const chunk of chunks(standingRows, 500)) {
    const { set, setWhere } = replaceUpdate(
      standing,
      [
        'rank',
        'points',
        'played',
        'won',
        'drawn',
        'lost',
        'otWon',
        'otLost',
        'goalsFor',
        'goalsAgainst',
        'form',
        'description',
        'source',
      ],
      { touchUpdatedAt: true },
    );
    await tx
      .insert(standing)
      .values(chunk)
      .onConflictDoUpdate({
        target: [standing.seasonId, standing.group, standing.participantId],
        set,
        setWhere,
      });
  }
  stats.standings = standingRows.length;

  await upsertPersonProfiles(tx, batch, scope, stats, { personId, participantId, seasonId });

  return stats;
}

// ─── perfil completo das pessoas ─────────────────────────────────────────────────────────────────

/**
 * Estatísticas por temporada (substituem as anteriores), transferências, títulos e afastamentos (só somam).
 * Títulos e afastamentos citam a pessoa pelo id do fornecedor: entram só as que já estão no core.
 */
async function upsertPersonProfiles(
  tx: Tx,
  batch: NormalizedBatch,
  scope: ProviderScope,
  stats: UpsertStats,
  refs: {
    personId: (pid: string | null) => string | null;
    participantId: (pid: string | null) => string | null;
    seasonId: (ref: SeasonRef | null) => string | null;
  },
): Promise<void> {
  const statRows = dedupeBy(
    batch.personSeasonStats.flatMap((r) => {
      const personId = refs.personId(r.personId);
      const participantId = refs.participantId(r.participantId);
      const seasonId = refs.seasonId(r.season);
      if (!personId || !participantId || !seasonId) return [];
      const { personId: _p, participantId: _t, season: _s, rating, ...values } = r;
      return [
        { personId, participantId, seasonId, ...values, rating: rating == null ? null : String(rating) },
      ];
    }),
    (r) => `${r.personId}|${r.participantId}|${r.seasonId}`,
  );
  for (const chunk of chunks(statRows, 500)) {
    const { set, setWhere } = replaceUpdate(
      personSeasonStat,
      [
        'position',
        'number',
        'captain',
        'appearances',
        'lineups',
        'minutes',
        'rating',
        'goals',
        'assists',
        'conceded',
        'saves',
        'yellowCards',
        'redCards',
        'stats',
      ],
      { touchUpdatedAt: true },
    );
    await tx
      .insert(personSeasonStat)
      .values(chunk)
      .onConflictDoUpdate({
        target: [personSeasonStat.personId, personSeasonStat.participantId, personSeasonStat.seasonId],
        set,
        setWhere,
      });
  }
  stats.seasonStats = statRows.length;

  const transferRows = batch.transfers.flatMap((t) => {
    const personId = refs.personId(t.personId);
    if (!personId) return [];
    return [
      {
        personId,
        date: t.date,
        type: t.type,
        fromParticipantId: refs.participantId(t.fromParticipantId),
        toParticipantId: refs.participantId(t.toParticipantId),
        fromName: t.fromName,
        toName: t.toName,
      },
    ];
  });
  for (const chunk of chunks(transferRows, 500)) {
    await tx.insert(personTransfer).values(chunk).onConflictDoNothing();
  }
  stats.transfers = transferRows.length;

  const cited = [...new Set([...batch.trophies, ...batch.sidelined].map((r) => r.personId))];
  const known = cited.length ? await resolveIds(tx, scope, 'person', cited) : new Map<string, string>();
  const trophyRows = batch.trophies.flatMap((t) => {
    const personId = known.get(t.personId);
    return personId
      ? [{ personId, league: t.league, country: t.country, season: t.season, place: t.place }]
      : [];
  });
  for (const chunk of chunks(trophyRows, 500)) {
    await tx.insert(personTrophy).values(chunk).onConflictDoNothing();
  }
  stats.trophies = trophyRows.length;

  const sidelinedRows = dedupeBy(
    batch.sidelined.flatMap((r) => {
      const personId = known.get(r.personId);
      return personId ? [{ personId, type: r.type, startDate: r.startDate, endDate: r.endDate }] : [];
    }),
    (r) => `${r.personId}|${r.type}|${r.startDate}`,
  );
  for (const chunk of chunks(sidelinedRows, 500)) {
    const { set, setWhere } = coalesceUpdate(personSidelined, ['endDate']);
    await tx
      .insert(personSidelined)
      .values(chunk)
      .onConflictDoUpdate({
        target: [personSidelined.personId, personSidelined.type, personSidelined.startDate],
        set,
        setWhere,
      });
  }
  stats.sidelined = sidelinedRows.length;
}

// ─── eventos ─────────────────────────────────────────────────────────────────────────────────────

interface EventRefs {
  competitionIds: Map<string, string>;
  seasonId: (ref: SeasonRef | null) => string | null;
  stageIds: Map<string, { id: string; kind: StageKind }>;
  venueId: (pid: string | null) => string | null;
  participantId: (pid: string | null) => string | null;
}

/** Evento gravado (ou já existente) cujo detalhe deste lote pode ser aplicado. */
interface AllowedEvent {
  id: string;
  source: NormalizedEvent;
  /** `false` quando outro provedor é o dono do estado: só o espelho do provedor é atualizado. */
  canonical: boolean;
  /** A observação deste lote foi aplicada ao estado (não era mais antiga que a última). */
  stateApplied: boolean;
}

async function matchAcrossProviders(
  tx: Executor,
  scope: ProviderScope,
  candidates: { providerId: string; startsAt: Date; participants: string[] }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const withParticipants = candidates.filter((c) => c.participants.length >= 2);
  if (!withParticipants.length) return out;
  const times = withParticipants.map((c) => c.startsAt.getTime());
  const from = new Date(Math.min(...times) - CROSS_PROVIDER_MATCH_MS);
  const to = new Date(Math.max(...times) + CROSS_PROVIDER_MATCH_MS);
  const allParticipants = [...new Set(withParticipants.flatMap((c) => c.participants))];
  const rows = await tx.execute<{ id: string; starts_at: string; parts: string[] }>(sql`
    select e.id, e.starts_at, array_agg(ep.participant_id::text order by ep.participant_id) as parts
    from core.event e
    join core.event_participant ep on ep.event_id = e.id
    where e.sport = ${scope.sport}
      and not e.is_provisional -- provisório tem regra própria (mesma competição e temporada)
      and e.starts_at between ${from.toISOString()}::timestamptz and ${to.toISOString()}::timestamptz
      and ep.participant_id in (${sql.join(
        allParticipants.map((p) => sql`${p}::uuid`),
        sql`, `,
      )})
      and not exists (
        select 1 from core.provider_map pm
        where pm.entity_type = 'event' and pm.entity_id = e.id and pm.provider = ${scope.provider}
      )
    group by e.id, e.starts_at`);
  for (const c of withParticipants) {
    const key = [...c.participants].sort().join(',');
    const hit = rows.find(
      (r) =>
        r.parts.join(',') === key &&
        Math.abs(new Date(r.starts_at).getTime() - c.startsAt.getTime()) <= CROSS_PROVIDER_MATCH_MS,
    );
    if (hit) out.set(c.providerId, hit.id);
  }
  return out;
}

/**
 * Jogos provisórios (curadoria) que o lote publica: mesma competição e temporada, mesmos participantes
 * (qualquer mando) e data a até 2 dias (`matchProvisional`). O jogo oficial assume o evento.
 */
async function matchProvisionalEvents(
  tx: Executor,
  sport: string,
  candidates: ProvisionalCandidate[],
): Promise<Map<string, string>> {
  const usable = candidates.filter((c) => c.competitionId && c.seasonId && c.participants.length >= 2);
  if (!usable.length) return new Map();
  const times = usable.map((c) => c.startsAt.getTime());
  const from = new Date(Math.min(...times) - PROVISIONAL_MATCH_MS);
  const to = new Date(Math.max(...times) + PROVISIONAL_MATCH_MS);
  const rows = await tx.execute<{
    id: string;
    competition_id: string | null;
    season_id: string | null;
    starts_at: string;
    parts: string[];
  }>(sql`
    select e.id, e.competition_id, e.season_id, e.starts_at,
           array_agg(ep.participant_id::text order by ep.participant_id) as parts
      from core.event e
      join core.event_participant ep on ep.event_id = e.id
     where e.is_provisional and e.sport = ${sport}
       and e.competition_id in (${sql.join(
         [...new Set(usable.map((c) => c.competitionId!))].map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
       and e.starts_at between ${from.toISOString()}::timestamptz and ${to.toISOString()}::timestamptz
     group by e.id`);
  return matchProvisional(
    usable,
    rows.map((r) => ({
      id: r.id,
      competitionId: r.competition_id,
      seasonId: r.season_id,
      startsAt: new Date(r.starts_at),
      participants: r.parts,
    })),
  );
}

async function upsertEvents(
  tx: Tx,
  batch: NormalizedBatch,
  scope: ProviderScope,
  options: UpsertOptions,
  stats: UpsertStats,
  refs: EventRefs,
): Promise<AllowedEvent[]> {
  const precedence = options.precedence ?? DEFAULT_PRECEDENCE;
  const derbyLookup: DerbyLookup | undefined =
    options.derbyLookup === false ? undefined : (options.derbyLookup ?? createDerbyLookup(tx));
  const events = dedupeBy(batch.events, (e) => e.id);
  const mapped = await resolveIds(
    tx,
    scope,
    'event',
    events.map((e) => e.id),
  );

  const unmapped = events.filter((e) => !mapped.has(e.id));
  const matched = await matchAcrossProviders(
    tx,
    scope,
    unmapped.map((e) => ({
      providerId: e.id,
      startsAt: e.observation.startsAt,
      participants: e.participants.flatMap((p) => refs.participantId(p.participantId) ?? []),
    })),
  );
  stats.events.matchedAcrossProviders = matched.size;
  // jogo provisório da curadoria: o oficial assume o evento (mesmo id; URLs, onde assistir e contexto ficam)
  const provisional = await matchProvisionalEvents(
    tx,
    batch.sport,
    unmapped
      .filter((e) => !matched.has(e.id))
      .map((e) => ({
        providerId: e.id,
        competitionId: e.competitionId ? (refs.competitionIds.get(e.competitionId) ?? null) : null,
        seasonId: refs.seasonId(e.season),
        startsAt: e.observation.startsAt,
        participants: e.participants.flatMap((p) => refs.participantId(p.participantId) ?? []),
      })),
  );
  for (const [providerId, eventId] of provisional) matched.set(providerId, eventId);

  const existingIds = [...mapped.values(), ...matched.values()];
  const existing = new Map<string, typeof event.$inferSelect>();
  for (const chunk of chunks(existingIds, 500)) {
    const rows = await tx.select().from(event).where(inArray(event.id, chunk)).for('update');
    for (const r of rows) existing.set(r.id, r);
  }

  const competitionUuids = [
    ...new Set(events.flatMap((e) => refs.competitionIds.get(e.competitionId ?? '') ?? [])),
  ];
  const comps = new Map<string, { tier: number; prestige: number; slug: string }>();
  for (const chunk of chunks(competitionUuids, 500)) {
    const rows = await tx
      .select({
        id: competition.id,
        tier: competition.tier,
        prestige: competition.prestige,
        slug: competition.slug,
      })
      .from(competition)
      .where(inArray(competition.id, chunk));
    for (const r of rows) comps.set(r.id, r);
  }

  // ─ importância: fatos estruturais do lote (perna do confronto e total de rodadas) ─
  const resolved = events.map((e) => {
    const seasonId = refs.seasonId(e.season);
    const stageRef = seasonId && e.stageLabel ? refs.stageIds.get(`${seasonId}|${e.stageLabel}`) : undefined;
    const sides = e.participants.flatMap((p) => refs.participantId(p.participantId) ?? []);
    const knockout = !!stageRef && sides.length === 2 && isKnockoutStage(stageRef.kind, e.stageLabel);
    return {
      e,
      seasonId,
      stageRef,
      sides,
      knockout,
      key: mapped.get(e.id) ?? matched.get(e.id) ?? `p:${e.id}`,
    };
  });
  const rounds = maxRounds(
    [...refs.stageIds.keys()].map((k) => {
      const i = k.indexOf('|');
      return { seasonId: k.slice(0, i), label: k.slice(i + 1) };
    }),
  );
  const tieMatches = new Map<string, TieMatch>();
  const koStages = [...new Set(resolved.flatMap((r) => (r.knockout ? [r.stageRef!.id] : [])))];
  for (const chunk of chunks(koStages, 200)) {
    const rows = await tx.execute<{ id: string; stage_id: string; starts_at: string; parts: string[] }>(sql`
      select e.id, e.stage_id, e.starts_at, array_agg(ep.participant_id::text) as parts
        from core.event e
        join core.event_participant ep on ep.event_id = e.id and ep.side in ('home', 'away')
       where e.stage_id in (${sql.join(
         chunk.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
         and e.status <> 'cancelled'
       group by e.id, e.stage_id, e.starts_at`);
    for (const r of rows)
      tieMatches.set(r.id, {
        key: r.id,
        stageId: r.stage_id,
        startsAt: new Date(r.starts_at),
        participants: r.parts,
      });
  }
  // a versão do lote vale mais que a gravada (horário pode ter mudado; evento novo ainda não existe)
  for (const r of resolved)
    if (r.knockout)
      tieMatches.set(r.key, {
        key: r.key,
        stageId: r.stageRef!.id,
        startsAt: r.e.observation.startsAt,
        participants: r.sides,
      });
  const ties = groupTies([...tieMatches.values()]);

  const writes: (typeof event.$inferInsert)[] = [];
  const logs: ReturnType<typeof logRows> = [];
  const links: { providerId: string; entityId: string }[] = [];
  const allowed: AllowedEvent[] = [];

  for (const { e, seasonId, stageRef, sides, knockout, key } of resolved) {
    const competitionId = e.competitionId ? (refs.competitionIds.get(e.competitionId) ?? null) : null;
    const comp = competitionId ? comps.get(competitionId) : undefined;
    const derby =
      derbyLookup && sides.length === 2 ? ((await derbyLookup(sides[0]!, sides[1]!)) ?? null) : null;

    const id = mapped.get(e.id) ?? matched.get(e.id);
    const prev = id ? existing.get(id) : undefined;

    const stageKind = stageRef?.kind ?? null;
    const rules = await competitionRules(comp?.slug, e.season?.year);
    const pair = knockout ? pairKey(stageRef!.id, sides) : null;
    const prevBreakdown = prev?.importanceBreakdown ?? null;
    // sem busca de clássicos nesta execução, o clássico gravado (e sua intensidade) continua valendo
    const scoredDerby = derbyLookup
      ? derby
      : prev?.derbyId
        ? { derbyId: prev.derbyId, intensity: derbyIntensityOf(prevBreakdown) ?? 3 }
        : null;
    const scored = importanceFromFacts({
      tier: comp?.tier ?? null,
      prestige: comp?.prestige ?? 0,
      stageKind,
      stageLabel: e.stageLabel,
      totalRounds: totalRoundsOf(rules, seasonId, stageKind, e.stageLabel, rounds),
      knockout: pair
        ? tieShape({ key }, ties.get(pair) ?? [], rulesLegs(rules, stageKind, e.stageLabel))
        : null,
      derby: scoredDerby,
      // sinais da tabela vêm do recálculo periódico (events:importance); o upsert só os preserva
      stakeFlags: prevBreakdown?.stake_flags ?? [],
    });
    // linha antiga (sem detalhamento) e sem busca de clássico: a importância gravada continua valendo
    const keepPrev = !derbyLookup && !!prev?.derbyId && !prevBreakdown;
    const context = {
      sport: batch.sport,
      competitionId,
      seasonId,
      stageId: stageRef?.id ?? null,
      venueId: refs.venueId(e.venueId),
      importance: keepPrev && prev ? prev.importance : scored.score,
      importanceBreakdown: keepPrev ? null : scored.breakdown,
      derbyId: derby?.derbyId ?? null,
    };

    if (!id || !prev) {
      const newId = id ?? uuidv7();
      const step = initialState(e.observation);
      writes.push({ id: newId, ...context, ...stateColumns(step.state), sourceProvider: batch.provider });
      logs.push(...logRows(newId, step.transitions, batch.provider));
      links.push({ providerId: e.id, entityId: newId });
      allowed.push({ id: newId, source: e, canonical: true, stateApplied: true });
      stats.events.inserted += 1;
      stats.events.transitions += step.transitions.length;
      continue;
    }
    if (!mapped.has(e.id)) links.push({ providerId: e.id, entityId: id });

    const prevState = stateFromRow(prev);
    const owner = { provider: prev.sourceProvider, lastValidAt: prev.lastValidAt, isStale: prev.isStale };
    if (!canOverride(precedence, owner, batch.provider, e.observation.observedAt)) {
      // outro provedor de maior precedência e com dado fresco é o dono do estado
      stats.events.skippedByPrecedence += 1;
      allowed.push({ id, source: e, canonical: false, stateApplied: false });
      continue;
    }
    const step = applyObservation(prevState, e.observation, options.machine);
    if (step.ignored) stats.events.ignored[step.ignored] = (stats.events.ignored[step.ignored] ?? 0) + 1;
    // observação antiga: o estado fica, mas o detalhe (timeline, escalações) ainda pode ser o melhor conhecido
    allowed.push({ id, source: e, canonical: true, stateApplied: step.ignored !== 'out_of_order' });
    if (step.ignored === 'out_of_order') continue;

    const nextContext = {
      ...context,
      // contexto nulo nesta resposta não apaga o conhecido
      competitionId: context.competitionId ?? prev.competitionId,
      seasonId: context.seasonId ?? prev.seasonId,
      stageId: context.stageId ?? prev.stageId,
      venueId: context.venueId ?? prev.venueId,
      // sem busca de clássicos nesta execução, preserva o clássico (e sua importância) já calculado
      derbyId: derbyLookup ? context.derbyId : prev.derbyId,
    };
    const sourceProvider = step.ignored ? prev.sourceProvider : batch.provider;
    const contextChanged =
      nextContext.competitionId !== prev.competitionId ||
      nextContext.seasonId !== prev.seasonId ||
      nextContext.stageId !== prev.stageId ||
      nextContext.venueId !== prev.venueId ||
      nextContext.importance !== prev.importance ||
      !sameBreakdown(nextContext.importanceBreakdown, prev.importanceBreakdown) ||
      nextContext.derbyId !== prev.derbyId ||
      sourceProvider !== prev.sourceProvider;
    if (!contextChanged && sameState(prevState, step.state)) {
      stats.events.unchanged += 1;
      continue;
    }
    writes.push({ id, ...nextContext, ...stateColumns(step.state), sourceProvider });
    logs.push(...logRows(id, step.transitions, batch.provider));
    stats.events.updated += 1;
    stats.events.transitions += step.transitions.length;
  }

  for (const chunk of chunks(writes, 300)) {
    const { set } = replaceUpdate(
      event,
      [
        'competitionId',
        'seasonId',
        'stageId',
        'venueId',
        'importance',
        'importanceBreakdown',
        'derbyId',
        'status',
        'statusDetail',
        'statusSource',
        'clock',
        'score',
        'startsAt',
        'endsAtExpected',
        'lastValidAt',
        'isStale',
        'sourceProvider',
      ],
      { touchUpdatedAt: true },
    );
    await tx.insert(event).values(chunk).onConflictDoUpdate({ target: event.id, set });
  }
  await linkIds(tx, scope, 'event', links);
  await insertLogs(tx, logs);

  // provisório assumido: vira oficial, a curadoria fica (registro e para o provisional:sync não recriar)
  for (const a of allowed) {
    if (!a.canonical || !a.stateApplied || !existing.get(a.id)?.isProvisional) continue;
    const merged = {
      mergedAt: batch.observedAt.toISOString(),
      mergedProvider: batch.provider,
      mergedProviderEventId: a.source.id,
    };
    await tx
      .update(event)
      .set({
        isProvisional: false,
        provisional: sql`coalesce(${event.provisional}, '{}'::jsonb) || ${JSON.stringify(merged)}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(event.id, a.id), eq(event.isProvisional, true)));
    stats.events.provisionalMerged += 1;
  }
  return allowed;
}

// ─── demais esportes: espelho e complementos ─────────────────────────────────────────────────────

/**
 * `core.sport_event_detail`: o resumo (item do fornecedor) acompanha o estado aplicado — uma lista mais
 * antiga não reescreve o resumo; o detalhe vindo dos complementos é preservado (mesmo padrão do futebol).
 */
async function upsertSportMirrors(tx: Tx, batch: NormalizedBatch, allowed: AllowedEvent[]): Promise<void> {
  const sd = sportEventDetail;
  for (const applied of [true, false]) {
    const mirrors = allowed.filter((e) => e.source.sportEvent && e.stateApplied === applied);
    const summary = applied ? sql`excluded.summary` : sql`${sd.summary}`;
    for (const chunk of chunks(mirrors, 200)) {
      await tx
        .insert(sd)
        .values(
          chunk.map(({ id, source }) => {
            const m = source.sportEvent!;
            return {
              eventId: id,
              sport: batch.sport,
              provider: batch.provider,
              providerEventId: m.providerEventId,
              kind: m.kind,
              summary: m.summary,
              detail: m.detail,
              detailFetchedAt: m.detail ? batch.observedAt : null,
            };
          }),
        )
        .onConflictDoUpdate({
          target: sd.eventId,
          set: { summary, updatedAt: sql`now()` },
          setWhere: sql`${sd.summary} is distinct from ${summary}`,
        });
    }
  }
}

/**
 * Complementos (F1 `rankings/races`/`startinggrid`, MMA `fights/results`): não passam pela máquina de
 * estados. Participantes são mesclados — `result` somado ao existente, `position` nula não apaga a
 * conhecida, nada é removido — e o detalhe é somado ao espelho, salvo se o já gravado for mais novo.
 */
async function upsertSupplements(
  tx: Tx,
  batch: NormalizedBatch,
  scope: ProviderScope,
  stats: UpsertStats,
  participantId: (pid: string | null) => string | null,
): Promise<void> {
  const supplements = batch.eventSupplements ?? [];
  if (!supplements.length) return;
  const eventIds = await resolveIds(
    tx,
    scope,
    'event',
    supplements.map((s) => s.eventId),
  );
  const ep = eventParticipant;
  const epRows = dedupeBy(
    supplements.flatMap((s) => {
      const eventId = eventIds.get(s.eventId);
      if (!eventId) return [];
      return s.participants.flatMap((p) => {
        const pid = participantId(p.participantId);
        return pid
          ? [{ eventId, participantId: pid, side: p.side, position: p.position, result: p.result }]
          : [];
      });
    }),
    (r) => `${r.eventId}|${r.participantId}`,
  );
  const result = sql`coalesce(${ep.result}, '{}'::jsonb) || coalesce(excluded.result, '{}'::jsonb)`;
  const position = sql`coalesce(excluded.position, ${ep.position})`;
  for (const chunk of chunks(epRows, 500)) {
    await tx
      .insert(ep)
      .values(chunk)
      .onConflictDoUpdate({
        target: [ep.eventId, ep.participantId],
        set: { side: sql`excluded.side`, position, result },
        setWhere: sql`(${ep.side}, ${ep.position}, ${ep.result}) is distinct from (excluded.side, ${position}, ${result})`,
      });
  }

  const sd = sportEventDetail;
  for (const s of supplements) {
    const eventId = eventIds.get(s.eventId);
    if (!eventId) {
      stats.supplements.missingEvent += 1;
      continue;
    }
    stats.supplements.applied += 1;
    if (!s.detail) continue;
    const next = sql`case
      when ${sd.detailFetchedAt} is not null and ${batch.observedAt.toISOString()}::timestamptz < ${sd.detailFetchedAt} then ${sd.detail}
      else coalesce(${sd.detail}, '{}'::jsonb) || ${JSON.stringify(s.detail)}::jsonb end`;
    const fetchedAt = sql`greatest(${sd.detailFetchedAt}, ${batch.observedAt.toISOString()}::timestamptz)`;
    await tx
      .update(sd)
      .set({ detail: next, detailFetchedAt: fetchedAt, updatedAt: sql`now()` })
      .where(
        and(
          eq(sd.eventId, eventId),
          sql`(${sd.detail}, ${sd.detailFetchedAt}) is distinct from (${next}, ${fetchedAt})`,
        ),
      );
  }
}
