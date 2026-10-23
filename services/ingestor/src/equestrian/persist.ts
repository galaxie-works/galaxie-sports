/**
 * Upsert idempotente do hipismo normalizado no schema `equestrian` (+ participante no core).
 * Chaves: atleta e cavalo pelo ID FEI; demais linhas por `(source, source_key)`. Reimportar o mesmo pacote
 * (ou um pacote novo da mesma fonte) atualiza as linhas existentes sem duplicar; `null` nunca apaga valor conhecido.
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  eqAthlete,
  eqCompetition,
  eqHorse,
  eqHorseOwner,
  eqRankingObservation,
  eqResult,
  eqRound,
  eqSourceDisagreement,
  eqTeamResult,
  country,
  noc,
  participant,
  providerMap,
} from '@galaxie/db';
import { chunks, coalesceUpdate, dedupeBy, type Executor } from '../normalize/sql-helpers.js';
import type { NormalizedEquestrian } from './normalize.js';

const CHUNK = 500;
const ts = (v: string | null) => (v ? new Date(v) : null);
const dec = (v: number | null) => (v === null ? null : String(v));

/** IOC/FEI → ISO2 do core (para bandeira e país do participante); `null` quando não há equivalência. */
async function iocToIso(db: Executor): Promise<Map<string, string>> {
  const [nocs, countries] = await Promise.all([
    db.select({ code: noc.code, iso2: noc.iso2 }).from(noc).where(isNotNull(noc.iso2)),
    db.select({ code: country.code, ioc: country.iocCode }).from(country),
  ]);
  const known = new Set(countries.map((c) => c.code));
  const map = new Map<string, string>();
  for (const c of countries) if (c.ioc) map.set(c.ioc, c.code);
  for (const n of nocs) if (n.iso2 && known.has(n.iso2) && !map.has(n.code)) map.set(n.code, n.iso2);
  return map;
}

export interface PersistCounts {
  athletes: number;
  horses: number;
  owners: number;
  competitions: number;
  results: number;
  rounds: number;
  teams: number;
  rankings: number;
  disagreements: number;
  participantsCreated: number;
}

export async function persistEquestrian(
  db: Executor,
  data: NormalizedEquestrian,
  ctx: { source: string; importRunId: string },
): Promise<PersistCounts> {
  const { source, importRunId } = ctx;
  const iso = await iocToIso(db);

  // ─── atletas ───────────────────────────────────────────────────────────────────────────────────
  const athleteCols = [
    'nameAsPublished',
    'displayName',
    'firstName',
    'familyName',
    'gender',
    'birthDate',
    'birthDateRaw',
    'nationality',
    'competingFor',
    'registryStatusRaw',
    'historyCoverage',
    'displayedTotalRaw',
    'collectedResults',
    'sourceUrl',
    'observedAt',
    'importRunId',
  ] as const;
  const athleteIds = new Map<string, string>();
  for (const part of chunks(
    dedupeBy(data.athletes, (a) => a.feiId),
    CHUNK,
  )) {
    const rows = await db
      .insert(eqAthlete)
      .values(part.map((a) => ({ ...a, source, observedAt: ts(a.observedAt), importRunId })))
      .onConflictDoUpdate({
        target: eqAthlete.feiId,
        ...coalesceUpdate(eqAthlete, athleteCols, { touchUpdatedAt: true }),
      })
      .returning({ id: eqAthlete.id, feiId: eqAthlete.feiId });
    for (const r of rows) if (r.feiId) athleteIds.set(r.feiId, r.id);
  }
  // linhas que não mudaram não voltam no RETURNING: completa o mapa
  const missing = data.athletes.filter((a) => !athleteIds.has(a.feiId)).map((a) => a.feiId);
  for (const part of chunks(missing, CHUNK)) {
    const rows = await db
      .select({ id: eqAthlete.id, feiId: eqAthlete.feiId })
      .from(eqAthlete)
      .where(inArray(eqAthlete.feiId, part));
    for (const r of rows) if (r.feiId) athleteIds.set(r.feiId, r.id);
  }

  // participante no core (busca/navegação) + provider_map, criado uma vez por ID FEI
  let participantsCreated = 0;
  const mapped = new Map<string, string>();
  for (const part of chunks([...athleteIds.keys()], CHUNK)) {
    const rows = await db
      .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
      .from(providerMap)
      .where(
        and(
          eq(providerMap.provider, 'fei'),
          eq(providerMap.sport, 'equestrian'),
          eq(providerMap.entityType, 'participant'),
          inArray(providerMap.providerId, part),
        ),
      );
    for (const r of rows) mapped.set(r.providerId, r.entityId);
  }
  const byFei = new Map(data.athletes.map((a) => [a.feiId, a]));
  for (const [feiId, athleteId] of athleteIds) {
    let participantId = mapped.get(feiId);
    const a = byFei.get(feiId)!;
    if (!participantId) {
      const [p] = await db
        .insert(participant)
        .values({
          sport: 'equestrian',
          kind: 'athlete',
          name: a.displayName,
          code: feiId,
          countryCode: a.competingFor ? (iso.get(a.competingFor) ?? null) : null,
        })
        .returning({ id: participant.id });
      participantId = p!.id;
      await db
        .insert(providerMap)
        .values({
          entityType: 'participant',
          entityId: participantId,
          provider: 'fei',
          sport: 'equestrian',
          providerId: feiId,
        })
        .onConflictDoNothing();
      participantsCreated++;
    }
    await db
      .update(eqAthlete)
      .set({ participantId })
      .where(and(eq(eqAthlete.id, athleteId)));
  }

  // ─── cavalos e proprietários ───────────────────────────────────────────────────────────────────
  const horseCols = [
    'name',
    'nameVariants',
    'birthName',
    'completeName',
    'birthDate',
    'birthDateRaw',
    'gender',
    'castrated',
    'color',
    'breed',
    'studbook',
    'breeder',
    'sire',
    'dam',
    'damSire',
    'birthCountry',
    'adminNf',
    'registryStatusRaw',
    'sourceUrl',
    'observedAt',
    'importRunId',
  ] as const;
  const horseIds = new Map<string, string>();
  const horses = dedupeBy(data.horses, (h) => h.feiId);
  for (const part of chunks(horses, CHUNK)) {
    const upd = coalesceUpdate(eqHorse, horseCols, { touchUpdatedAt: true });
    // ficha detalhada nunca volta a "pendente"
    upd.set.profileStatus = sql`case when ${eqHorse.profileStatus} = 'detailed' then 'detailed' else excluded.profile_status end`;
    await db
      .insert(eqHorse)
      .values(part.map((h) => ({ ...h, source, observedAt: ts(h.observedAt), importRunId })))
      .onConflictDoUpdate({ target: eqHorse.feiId, set: upd.set });
  }
  for (const part of chunks(
    horses.map((h) => h.feiId),
    CHUNK,
  )) {
    const rows = await db
      .select({ id: eqHorse.id, feiId: eqHorse.feiId })
      .from(eqHorse)
      .where(inArray(eqHorse.feiId, part));
    for (const r of rows) if (r.feiId) horseIds.set(r.feiId, r.id);
  }
  const owners = data.owners.filter((o) => horseIds.has(o.horseFeiId));
  for (const part of chunks(
    dedupeBy(owners, (o) => o.sourceKey),
    CHUNK,
  )) {
    await db
      .insert(eqHorseOwner)
      .values(
        part.map((o) => ({
          horseId: horseIds.get(o.horseFeiId)!,
          ownerName: o.ownerName,
          nationality: o.nationality,
          sinceRaw: o.sinceRaw,
          percentageRaw: o.percentageRaw,
          source,
          sourceKey: o.sourceKey,
          sourceUrl: o.sourceUrl,
          observedAt: ts(o.observedAt),
          importRunId,
        })),
      )
      .onConflictDoUpdate({
        target: [eqHorseOwner.source, eqHorseOwner.sourceKey],
        ...coalesceUpdate(eqHorseOwner, [
          'ownerName',
          'nationality',
          'sinceRaw',
          'percentageRaw',
          'sourceUrl',
          'observedAt',
          'importRunId',
        ]),
      });
  }

  // ─── provas ────────────────────────────────────────────────────────────────────────────────────
  const compCols = [
    'name',
    'level',
    'stars',
    'levelKind',
    'date',
    'dateRaw',
    'venue',
    'countryCode',
    'heightCm',
    'articleCode',
    'articleText',
    'judging',
    'isGrandPrix',
    'scheduleNumber',
    'showKey',
    'showStart',
    'showEnd',
    'prizeTotal',
    'prizeCurrency',
    'prizeTotalRaw',
    'displayedEntries',
    'observedEntries',
    'allEntriesObserved',
    'feiReferenceCode',
    'sourceUrl',
    'observedAt',
    'importRunId',
  ] as const;
  const compIds = new Map<string, string>();
  const comps = dedupeBy(data.competitions, (c) => c.sourceKey);
  for (const part of chunks(comps, CHUNK)) {
    await db
      .insert(eqCompetition)
      .values(
        part.map((c) => ({
          ...c,
          source,
          prizeTotal: dec(c.prizeTotal),
          observedAt: ts(c.observedAt),
          importRunId,
        })),
      )
      .onConflictDoUpdate({
        target: [eqCompetition.source, eqCompetition.sourceKey],
        ...coalesceUpdate(eqCompetition, compCols, { touchUpdatedAt: true }),
      });
  }
  for (const part of chunks(
    comps.map((c) => c.sourceKey),
    CHUNK,
  )) {
    const rows = await db
      .select({ id: eqCompetition.id, key: eqCompetition.sourceKey })
      .from(eqCompetition)
      .where(and(eq(eqCompetition.source, source), inArray(eqCompetition.sourceKey, part)));
    for (const r of rows) compIds.set(r.key, r.id);
  }

  const aId = (fei: string | null) => (fei ? (athleteIds.get(fei) ?? null) : null);
  const hId = (fei: string | null) => (fei ? (horseIds.get(fei) ?? null) : null);

  // ─── classificações ────────────────────────────────────────────────────────────────────────────
  const resultCols = [
    'sourceKind',
    'competitionId',
    'athleteId',
    'athleteNameAsPublished',
    'horseId',
    'horseNameAsPublished',
    'countryCode',
    'countryBasis',
    'date',
    'position',
    'positionRaw',
    'status',
    'scoreRaw',
    'scoreParseStatus',
    'penalties',
    'penaltiesJumping',
    'penaltiesTime',
    'timeSeconds',
    'scoreParts',
    'roundCells',
    'publishedBreakdown',
    'prizeAmount',
    'prizeCurrency',
    'prizeRaw',
    'qualityFlags',
    'sourceUrl',
    'observedAt',
    'importRunId',
  ] as const;
  const results = dedupeBy(data.results, (r) => r.sourceKey);
  for (const part of chunks(results, CHUNK)) {
    await db
      .insert(eqResult)
      .values(
        part.map((r) => ({
          source,
          sourceKey: r.sourceKey,
          sourceKind: r.sourceKind,
          competitionId: r.competitionKey ? (compIds.get(r.competitionKey) ?? null) : null,
          athleteId: aId(r.athleteFeiId),
          athleteNameAsPublished: r.athleteNameAsPublished,
          horseId: hId(r.horseFeiId),
          horseNameAsPublished: r.horseNameAsPublished,
          countryCode: r.countryCode,
          countryBasis: r.countryBasis,
          date: r.date,
          position: r.position,
          positionRaw: r.positionRaw,
          status: r.status as 'classified',
          scoreRaw: r.scoreRaw,
          scoreParseStatus: r.scoreParseStatus,
          penalties: dec(r.penalties),
          penaltiesJumping: dec(r.penaltiesJumping),
          penaltiesTime: dec(r.penaltiesTime),
          timeSeconds: dec(r.timeSeconds),
          scoreParts: r.scoreParts,
          roundCells: r.roundCells,
          publishedBreakdown: r.publishedBreakdown,
          prizeAmount: dec(r.prizeAmount),
          prizeCurrency: r.prizeCurrency,
          prizeRaw: r.prizeRaw,
          qualityFlags: r.qualityFlags,
          sourceUrl: r.sourceUrl,
          observedAt: ts(r.observedAt),
          importRunId,
        })),
      )
      .onConflictDoUpdate({
        target: [eqResult.source, eqResult.sourceKey],
        ...coalesceUpdate(eqResult, resultCols, { touchUpdatedAt: true }),
      });
  }

  // ─── rodadas, equipes, rankings, divergências ──────────────────────────────────────────────────
  const roundCols = [
    'eventKey',
    'stage',
    'date',
    'datePrecision',
    'eventStart',
    'eventEnd',
    'athleteId',
    'athleteNameAsPublished',
    'horseId',
    'horseNameAsPublished',
    'countryCode',
    'bib',
    'rankRaw',
    'status',
    'penaltiesJumping',
    'penaltiesTime',
    'score',
    'scoreRaw',
    'scoreSemantics',
    'timeSeconds',
    'sourceUrl',
    'sourcePdfPage',
    'sourceDocumentSha256',
    'observedAt',
    'importRunId',
  ] as const;
  for (const part of chunks(
    dedupeBy(data.rounds, (r) => r.sourceKey),
    CHUNK,
  )) {
    await db
      .insert(eqRound)
      .values(
        part.map((r) => ({
          source,
          sourceKey: r.sourceKey,
          eventKey: r.eventKey,
          stage: r.stage,
          date: r.date,
          datePrecision: r.datePrecision,
          eventStart: r.eventStart,
          eventEnd: r.eventEnd,
          athleteId: aId(r.athleteFeiId),
          athleteNameAsPublished: r.athleteNameAsPublished,
          horseId: hId(r.horseFeiId),
          horseNameAsPublished: r.horseNameAsPublished,
          countryCode: r.countryCode,
          bib: r.bib,
          rankRaw: r.rankRaw,
          status: r.status,
          penaltiesJumping: dec(r.penaltiesJumping),
          penaltiesTime: dec(r.penaltiesTime),
          score: dec(r.score),
          scoreRaw: r.scoreRaw,
          scoreSemantics: r.scoreSemantics,
          timeSeconds: dec(r.timeSeconds),
          sourceUrl: r.sourceUrl,
          sourcePdfPage: r.sourcePdfPage,
          sourceDocumentSha256: r.sourceDocumentSha256,
          observedAt: ts(r.observedAt),
          importRunId,
        })),
      )
      .onConflictDoUpdate({
        target: [eqRound.source, eqRound.sourceKey],
        ...coalesceUpdate(eqRound, roundCols),
      });
  }

  for (const part of chunks(
    dedupeBy(data.teams, (t) => t.sourceKey),
    CHUNK,
  )) {
    await db
      .insert(eqTeamResult)
      .values(part.map((t) => ({ ...t, source, observedAt: ts(t.observedAt), importRunId })))
      .onConflictDoUpdate({
        target: [eqTeamResult.source, eqTeamResult.sourceKey],
        ...coalesceUpdate(eqTeamResult, [
          'eventKey',
          'countryCode',
          'position',
          'positionRaw',
          'scoreRaw',
          'prizeRaw',
          'members',
          'arithmetic',
          'sourceUrl',
          'sourcePdfPage',
          'observedAt',
          'importRunId',
        ]),
      });
  }

  for (const part of chunks(
    dedupeBy(data.rankings, (r) => r.sourceKey),
    CHUNK,
  )) {
    await db
      .insert(eqRankingObservation)
      .values(
        part.map((r) => ({
          source,
          sourceKey: r.sourceKey,
          rankingName: r.rankingName,
          athleteId: aId(r.athleteFeiId),
          horseId: hId(r.horseFeiId),
          horseNameAsPublished: r.horseNameAsPublished,
          rank: r.rank,
          rankRaw: r.rankRaw,
          points: dec(r.points),
          pointsRaw: r.pointsRaw,
          edition: r.edition,
          coverage: r.coverage,
          sourceUrl: r.sourceUrl,
          observedAt: ts(r.observedAt),
          importRunId,
        })),
      )
      .onConflictDoUpdate({
        target: [eqRankingObservation.source, eqRankingObservation.sourceKey],
        ...coalesceUpdate(eqRankingObservation, [
          'rankingName',
          'athleteId',
          'horseId',
          'horseNameAsPublished',
          'rank',
          'rankRaw',
          'points',
          'pointsRaw',
          'edition',
          'coverage',
          'sourceUrl',
          'observedAt',
          'importRunId',
        ]),
      });
  }

  for (const part of chunks(
    dedupeBy(data.disagreements, (d) => d.sourceKey),
    CHUNK,
  )) {
    await db
      .insert(eqSourceDisagreement)
      .values(
        part.map((d) => ({
          source,
          sourceKey: d.sourceKey,
          athleteId: aId(d.athleteFeiId),
          eventKey: d.eventKey,
          field: d.field,
          values: d.values,
          resolution: d.resolution,
          importRunId,
        })),
      )
      .onConflictDoUpdate({
        target: [eqSourceDisagreement.source, eqSourceDisagreement.sourceKey],
        ...coalesceUpdate(eqSourceDisagreement, [
          'athleteId',
          'eventKey',
          'field',
          'values',
          'resolution',
          'importRunId',
        ]),
      });
  }

  return {
    athletes: athleteIds.size,
    horses: horseIds.size,
    owners: owners.length,
    competitions: compIds.size,
    results: results.length,
    rounds: data.rounds.length,
    teams: data.teams.length,
    rankings: data.rankings.length,
    disagreements: data.disagreements.length,
    participantsCreated,
  };
}
