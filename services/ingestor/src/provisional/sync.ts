/**
 * Grava os jogos provisórios da curadoria em `core.event` (idempotente): cria ou atualiza o evento na
 * competição, temporada e fase certas, com os participantes e o estádio já conhecidos pelo ID do
 * fornecedor. O evento nasce sem `provider_map` do fornecedor e com `is_provisional`; a normalização
 * assume o evento quando o jogo oficial chega (`matchProvisional` em upsert-core).
 *
 * Usa o mesmo advisory lock da normalização do fornecedor: o jogo oficial e o provisório nunca são
 * gravados ao mesmo tempo (sem isso, os dois poderiam nascer como eventos separados).
 */
import { and, eq, sql, TransactionRollbackError } from 'drizzle-orm';
import {
  competition,
  event,
  eventParticipant,
  eventStateLog,
  providerMap,
  publishChange,
  season,
  stage,
  type Database,
  type EventProvisional,
} from '@galaxie/db';
import { expectedEnd, parseRound, preMatchStatus } from '@galaxie/providers';
import { recomputeEventImportance } from '../normalize/importance.js';
import type { Tx } from '../normalize/sql-helpers.js';
import { uuidv7 } from '../normalize/uuid.js';
import { provisionalKickoff, type ProvisionalFixture, type ProvisionalSide } from './config.js';
import { PROVISIONAL_MATCH_MS, PROVISIONAL_PROVIDER } from './match.js';

/** Fornecedor dos IDs citados na curadoria (times, estádios). */
const SOURCE_PROVIDER = 'api-sports';

export type ProvisionalOutcome = 'created' | 'updated' | 'unchanged' | 'official' | 'cancelled' | 'pending';

export interface ProvisionalResult {
  key: string;
  outcome: ProvisionalOutcome;
  eventId: string | null;
  /** Por que ficou pendente, ou o que já é oficial. */
  detail: string | null;
}

export interface ProvisionalSyncOptions {
  now?: Date;
  /** Calcula sem gravar. */
  dryRun?: boolean;
}

class Pending extends Error {}

/** JSON com as chaves em ordem: o jsonb do Postgres não guarda a ordem em que o objeto foi escrito. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Advisory lock da normalização do fornecedor para o esporte (mesma chave de `upsertBatch`). */
const lockKey = (sport: string) => `normalize:${SOURCE_PROVIDER}:${sport}`;

async function providerEntity(
  tx: Tx,
  sport: string,
  entityType: 'participant' | 'venue',
  providerId: number,
): Promise<string | null> {
  const rows = await tx
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, SOURCE_PROVIDER),
        eq(providerMap.sport, sport),
        eq(providerMap.entityType, entityType),
        eq(providerMap.providerId, String(providerId)),
      ),
    );
  return rows[0]?.id ?? null;
}

/**
 * Classificado de um confronto (`winner_of`): o participante marcado como vencedor no último jogo
 * encerrado da fase entre os dois times (a api-sports marca o classificado também quando ele perde a volta
 * e passa nos pênaltis).
 */
async function tieWinner(
  tx: Tx,
  seasonId: string,
  stageLabel: string,
  teams: [string, string],
): Promise<string | null> {
  const rows = await tx.execute<{ winner: string | null }>(sql`
    select (select ep.participant_id::text from core.event_participant ep
             where ep.event_id = e.id and (ep.result->>'winner')::boolean
               and ep.participant_id in (${sql`${teams[0]}::uuid`}, ${sql`${teams[1]}::uuid`})) as winner
      from core.event e
      join core.stage st on st.id = e.stage_id
     where e.season_id = ${seasonId} and st.provider_label = ${stageLabel} and e.status = 'finished'
       and (select count(*) from core.event_participant ep
             where ep.event_id = e.id
               and ep.participant_id in (${sql`${teams[0]}::uuid`}, ${sql`${teams[1]}::uuid`})) = 2
     order by e.starts_at desc
     limit 1`);
  return rows[0]?.winner ?? null;
}

async function resolveSide(
  tx: Tx,
  f: ProvisionalFixture,
  seasonId: string,
  side: ProvisionalSide,
  label: string,
): Promise<string> {
  if ('team' in side) {
    const id = await providerEntity(tx, f.sport, 'participant', side.team);
    if (!id) throw new Pending(`${label} ${side.name} (${side.team}) não está no core`);
    return id;
  }
  const teams: string[] = [];
  for (const t of side.winner_of.teams) {
    const id = await providerEntity(tx, f.sport, 'participant', t);
    if (!id) throw new Pending(`${label}: time ${t} do confronto não está no core`);
    teams.push(id);
  }
  const winner = await tieWinner(tx, seasonId, side.winner_of.stage, teams as [string, string]);
  if (!winner) throw new Pending(`${label}: aguardando o classificado de ${side.winner_of.stage}`);
  return winner;
}

/** Jogo do fornecedor já publicado para o mesmo confronto (mesma competição/temporada, data a até 2 dias). */
async function officialTwin(
  tx: Tx,
  ctx: { sport: string; competitionId: string; seasonId: string; startsAt: Date },
  participants: string[],
): Promise<string | null> {
  const from = new Date(ctx.startsAt.getTime() - PROVISIONAL_MATCH_MS).toISOString();
  const to = new Date(ctx.startsAt.getTime() + PROVISIONAL_MATCH_MS).toISOString();
  const key = [...participants].sort().join(',');
  const rows = await tx.execute<{ id: string; parts: string[] }>(sql`
    select e.id, array_agg(ep.participant_id::text order by ep.participant_id) as parts
      from core.event e
      join core.event_participant ep on ep.event_id = e.id
     where e.sport = ${ctx.sport} and e.competition_id = ${ctx.competitionId} and e.season_id = ${ctx.seasonId}
       and not e.is_provisional
       and e.starts_at between ${from}::timestamptz and ${to}::timestamptz
       and exists (select 1 from core.provider_map pm
                    where pm.entity_type = 'event' and pm.entity_id = e.id and pm.provider = ${SOURCE_PROVIDER})
     group by e.id`);
  return rows.find((r) => r.parts.join(',') === key)?.id ?? null;
}

async function syncOne(tx: Tx, f: ProvisionalFixture, now: Date): Promise<ProvisionalResult> {
  const result = (outcome: ProvisionalOutcome, eventId: string | null, detail: string | null = null) => ({
    key: f.key,
    outcome,
    eventId,
    detail,
  });

  const existing = (
    await tx
      .select()
      .from(event)
      .where(sql`${event.provisional}->>'key' = ${f.key}`)
      .for('update')
  )[0];
  if (existing && !existing.isProvisional)
    return result('official', existing.id, existing.provisional?.mergedProviderEventId ?? null);

  if (f.status === 'cancelled') {
    if (!existing) return result('unchanged', null, 'cancelado antes de ser gravado');
    if (existing.status === 'cancelled') return result('unchanged', existing.id);
    await tx
      .update(event)
      .set({ status: 'cancelled', statusDetail: 'CANC', updatedAt: now })
      .where(eq(event.id, existing.id));
    await tx.insert(eventStateLog).values({
      eventId: existing.id,
      fromStatus: existing.status,
      toStatus: 'cancelled',
      reason: 'editorial',
      payload: { provider: PROVISIONAL_PROVIDER, provisional: f.key },
      occurredAt: now,
    });
    return result('cancelled', existing.id);
  }

  const comp = (
    await tx
      .select({ id: competition.id })
      .from(competition)
      .where(and(eq(competition.sport, f.sport), eq(competition.slug, f.competition)))
  )[0];
  if (!comp) throw new Pending(`competição ${f.competition} não está no core`);
  const seasonRow = (
    await tx
      .select({ id: season.id })
      .from(season)
      .where(and(eq(season.competitionId, comp.id), eq(season.year, f.season)))
  )[0];
  if (!seasonRow) throw new Pending(`temporada ${f.season} de ${f.competition} não está no core`);

  const home = await resolveSide(tx, f, seasonRow.id, f.home, 'mandante');
  const away = await resolveSide(tx, f, seasonRow.id, f.away, 'visitante');
  if (home === away) throw new Pending('mandante e visitante resolvem para o mesmo time');
  const venueId = f.venue ? await providerEntity(tx, f.sport, 'venue', f.venue.id) : null;
  if (f.venue && !venueId) throw new Pending(`estádio ${f.venue.name} (${f.venue.id}) não está no core`);

  const { startsAt, timeConfirmed } = provisionalKickoff(f);
  const twin = await officialTwin(
    tx,
    { sport: f.sport, competitionId: comp.id, seasonId: seasonRow.id, startsAt },
    [home, away],
  );
  if (twin)
    return existing
      ? result('pending', existing.id, `o fornecedor já publicou o jogo (${twin}) e a junção não aconteceu`)
      : result('official', twin, 'o fornecedor já publicou o jogo');

  // temporada: o fim informado pelo fornecedor (último jogo que ele conhece) passa a cobrir o anunciado
  const seasonExtended =
    (
      await tx
        .update(season)
        .set({ endDate: f.date, updatedAt: now })
        .where(and(eq(season.id, seasonRow.id), sql`${season.endDate} < ${f.date}::date`))
        .returning({ id: season.id })
    ).length > 0;

  // fase: a mesma linha que a api-sports vai usar (temporada + rótulo); o fornecedor continua dono do nome
  const round = parseRound(f.stage);
  await tx
    .insert(stage)
    .values({
      seasonId: seasonRow.id,
      kind: round.kind,
      name: round.name,
      providerLabel: f.stage,
      order: round.order,
    })
    .onConflictDoNothing();
  const stageId = (
    await tx
      .select({ id: stage.id })
      .from(stage)
      .where(and(eq(stage.seasonId, seasonRow.id), eq(stage.providerLabel, f.stage)))
  )[0]!.id;

  const provisional: EventProvisional = {
    key: f.key,
    origin: f.origin,
    announcedBy: f.announced_by,
    timeConfirmed,
    sources: f.sources.map((s) => ({ name: s.name, url: s.url, checkedAt: s.checked_at })),
    note: f.note,
  };
  const status = preMatchStatus(startsAt, now);
  const columns = {
    sport: f.sport,
    competitionId: comp.id,
    seasonId: seasonRow.id,
    stageId,
    venueId,
    startsAt,
    endsAtExpected: expectedEnd({ sport: f.sport, startsAt }),
    statusDetail: timeConfirmed ? 'NS' : 'TBD',
    sourceProvider: PROVISIONAL_PROVIDER,
    isProvisional: true,
    provisional,
  };
  const sides = [
    { participantId: home, side: 'home' },
    { participantId: away, side: 'away' },
  ];

  if (!existing) {
    const id = uuidv7(now.getTime());
    await tx.insert(event).values({ id, ...columns, status, statusSource: 'temporal' });
    await tx.insert(eventParticipant).values(sides.map((s) => ({ eventId: id, ...s })));
    await tx.insert(eventStateLog).values({
      eventId: id,
      fromStatus: null,
      toStatus: status,
      reason: 'editorial',
      payload: { provider: PROVISIONAL_PROVIDER, provisional: f.key },
      occurredAt: now,
    });
    return result('created', id);
  }

  const currentSides = await tx
    .select({ participantId: eventParticipant.participantId, side: eventParticipant.side })
    .from(eventParticipant)
    .where(eq(eventParticipant.eventId, existing.id));
  const sidesKey = (rows: { participantId: string; side: string }[]) =>
    rows
      .map((r) => `${r.side}:${r.participantId}`)
      .sort()
      .join('|');
  // reanunciado depois de cancelado volta ao pré-jogo; senão, o relógio (events:clock) é dono do estado
  const nextStatus = existing.status === 'cancelled' ? status : existing.status;
  const changed =
    existing.competitionId !== columns.competitionId ||
    existing.seasonId !== columns.seasonId ||
    existing.stageId !== columns.stageId ||
    existing.venueId !== columns.venueId ||
    existing.startsAt.getTime() !== startsAt.getTime() ||
    existing.endsAtExpected.getTime() !== columns.endsAtExpected.getTime() ||
    existing.statusDetail !== columns.statusDetail ||
    existing.status !== nextStatus ||
    stableJson(existing.provisional) !== stableJson(provisional);
  const sidesChanged = sidesKey(currentSides) !== sidesKey(sides);
  if (!changed && !sidesChanged)
    return seasonExtended
      ? result('updated', existing.id, `temporada estendida até ${f.date}`)
      : result('unchanged', existing.id);

  if (changed)
    await tx
      .update(event)
      .set({ ...columns, status: nextStatus, updatedAt: now })
      .where(eq(event.id, existing.id));
  if (nextStatus !== existing.status)
    await tx.insert(eventStateLog).values({
      eventId: existing.id,
      fromStatus: existing.status,
      toStatus: nextStatus,
      reason: 'editorial',
      payload: { provider: PROVISIONAL_PROVIDER, provisional: f.key },
      occurredAt: now,
    });
  if (sidesChanged) {
    await tx.delete(eventParticipant).where(eq(eventParticipant.eventId, existing.id));
    await tx.insert(eventParticipant).values(sides.map((s) => ({ eventId: existing.id, ...s })));
  }
  return result('updated', existing.id);
}

/**
 * Sincroniza a curadoria com o core. Uma transação por jogo: um jogo pendente (time ainda fora do core,
 * classificado indefinido) não impede os outros. No fim, recalcula clássico e importância dos eventos
 * gravados pelo mesmo caminho do `events:importance` e publica a mudança no change feed (purga as listas).
 */
export async function syncProvisionalFixtures(
  db: Database,
  fixtures: readonly ProvisionalFixture[],
  options: ProvisionalSyncOptions = {},
): Promise<ProvisionalResult[]> {
  const now = options.now ?? new Date();
  const results: ProvisionalResult[] = [];
  for (const f of fixtures) {
    try {
      results.push(
        await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey(f.sport)}))`);
          const r = await syncOne(tx, f, now);
          if (options.dryRun) {
            // a transação é desfeita, mas o resultado (o que seria feito) fica no relatório
            results.push(r);
            tx.rollback();
          }
          if (
            r.eventId &&
            (r.outcome === 'created' || r.outcome === 'updated' || r.outcome === 'cancelled')
          ) {
            const tags = (
              await tx
                .select({ participantId: eventParticipant.participantId })
                .from(eventParticipant)
                .where(eq(eventParticipant.eventId, r.eventId))
            ).map((p) => `participant:${p.participantId}`);
            const comp = (
              await tx
                .select({ competitionId: event.competitionId })
                .from(event)
                .where(eq(event.id, r.eventId))
            )[0]?.competitionId;
            await publishChange(tx, {
              topic: 'event.provisional',
              entityType: 'event',
              entityId: r.eventId,
              payload: {
                key: f.key,
                outcome: r.outcome,
                tags: [...tags, ...(comp ? [`competition:${comp}`] : [])],
              },
            });
          }
          return r;
        }),
      );
    } catch (err) {
      if (err instanceof TransactionRollbackError) continue;
      if (err instanceof Pending) {
        results.push({ key: f.key, outcome: 'pending', eventId: null, detail: err.message });
        continue;
      }
      throw err;
    }
  }

  const written = results
    .filter((r) => r.eventId && (r.outcome === 'created' || r.outcome === 'updated'))
    .map((r) => r.eventId!);
  if (written.length && !options.dryRun) await recomputeEventImportance(db, { eventIds: written, now });
  return results;
}
