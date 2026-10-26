/**
 * Onde o ao vivo lê e grava: candidatos do core, retratos para o diff, aplicação do lote normalizado
 * (máquina de estados + *last-known-good*) e publicação no change feed. `PgLiveStore` é a versão real;
 * `InMemoryLiveStore` (memory-store.ts) reproduz a mesma semântica nos testes e na simulação.
 */
import { inArray, sql } from 'drizzle-orm';
import { event, eventIncident, publishChange, type Database } from '@galaxie/db';
import type { EventStatus, FailureReason, NormalizedBatch, StatusSource } from '@galaxie/providers';
import { applyProviderFailure } from '../normalize/event-state.js';
import { resolveIds } from '../normalize/sql-helpers.js';
import { upsertBatch, type UpsertOptions } from '../normalize/upsert-core.js';
import type { EventSnapshot, LiveChange } from './diff.js';
import type { LiveCandidate, LivePriority } from './types.js';

export interface LiveFailureInput {
  provider: string;
  sport: string;
  providerEventIds: readonly string[];
  at: Date;
  reason: FailureReason;
}

export interface LiveStore {
  /** Eventos do esporte com início em [from, to) — e os ainda em andamento que começaram antes. */
  candidates(sport: string, provider: string, from: Date, to: Date): Promise<LiveCandidate[]>;
  /** Retrato atual dos eventos (chave: ID do provedor); eventos desconhecidos ficam de fora. */
  snapshots(
    provider: string,
    sport: string,
    providerEventIds: readonly string[],
  ): Promise<Map<string, EventSnapshot>>;
  /** Aplica um lote válido do provedor (upsert idempotente + máquina de estados). */
  applyBatch(batch: NormalizedBatch): Promise<void>;
  /** A fonte falhou: mantém o último estado válido e marca `is_stale`. Devolve quantos mudaram. */
  applyFailure(input: LiveFailureInput): Promise<number>;
  /** Publica sinais no change feed (SSE, webhooks, purge). Devolve quantos foram publicados. */
  publish(changes: readonly LiveChange[]): Promise<number>;
  /** Eventos que acabaram de terminar (ex.: recalcular a tabela da temporada). */
  onFinished?(changes: readonly LiveChange[]): Promise<void>;
}

const LIVE_PRIORITIES = new Set<LivePriority>(['high', 'medium', 'low', 'none']);

export function asLivePriority(value: string | null | undefined): LivePriority {
  return value && LIVE_PRIORITIES.has(value as LivePriority) ? (value as LivePriority) : 'none';
}

/** Payload publicado no change feed para uma mudança ao vivo (tópico `live`). */
export function changePayload(change: LiveChange): Record<string, unknown> {
  return {
    kinds: change.kinds,
    status: change.status,
    statusDetail: change.statusDetail,
    score: change.score,
    clock: change.clock,
    previous: change.previous,
    incidents: change.incidents,
    removedIncidents: change.removedIncidents,
    goal: change.goal,
    finished: change.finished,
    providerEventId: change.providerEventId,
    tags: [
      'live',
      ...(change.competitionId ? [`competition:${change.competitionId}`] : []),
      ...(change.seasonId ? [`season:${change.seasonId}`] : []),
    ],
  };
}

type CandidateRow = {
  id: string;
  sport: string;
  competition_id: string | null;
  season_id: string | null;
  starts_at: Date | string;
  status: EventStatus;
  status_source: StatusSource;
  status_detail: string | null;
  clock: LiveCandidate['clock'];
  score: LiveCandidate['score'];
  last_valid_at: Date | string | null;
  importance: number;
  derby: boolean;
  tier: number | null;
  live_priority: string | null;
  stage_kind: string | null;
  provider_event_id: string | null;
  provider_competition_id: string | null;
  label: string | null;
};

const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

export interface PgLiveStoreOptions {
  upsert?: UpsertOptions;
  /** Publica `topic = live` no `ops.change_feed` (padrão: true). */
  publish?: boolean;
  /** Chamado com as mudanças que terminaram jogos (ex.: recálculo de tabelas). */
  onFinished?: (changes: readonly LiveChange[]) => Promise<void>;
}

export class PgLiveStore implements LiveStore {
  constructor(
    private readonly db: Database,
    private readonly options: PgLiveStoreOptions = {},
  ) {}

  async candidates(sport: string, provider: string, from: Date, to: Date): Promise<LiveCandidate[]> {
    const rows = await this.db.execute<CandidateRow>(sql`
      select distinct on (e.starts_at, e.id)
             e.id, e.sport, e.competition_id, e.season_id, e.starts_at, e.status, e.status_source, e.status_detail,
             e.clock, e.score, e.last_valid_at, e.importance, (e.derby_id is not null) as derby,
             c.tier, c.live_priority, s.kind as stage_kind,
             pe.provider_id as provider_event_id, pc.provider_id as provider_competition_id,
             (select string_agg(p.name, ' x ' order by case ep.side when 'home' then 0 when 'away' then 1 else 2 end, p.name)
                from core.event_participant ep join core.participant p on p.id = ep.participant_id
               where ep.event_id = e.id) as label
        from core.event e
        left join core.competition c on c.id = e.competition_id
        left join core.stage s on s.id = e.stage_id
        left join core.provider_map pe
          on pe.entity_type = 'event' and pe.entity_id = e.id and pe.provider = ${provider} and pe.sport = e.sport
        left join core.provider_map pc
          on pc.entity_type = 'competition' and pc.entity_id = e.competition_id
         and pc.provider = ${provider} and pc.sport = e.sport
       where e.sport = ${sport}
         and e.starts_at < ${to.toISOString()}::timestamptz
         and (e.starts_at >= ${from.toISOString()}::timestamptz
              or (e.status in ('live', 'break', 'suspended') and e.starts_at >= ${new Date(from.getTime() - 86_400_000).toISOString()}::timestamptz))
       order by e.starts_at, e.id, pe.provider_id, pc.provider_id`);
    return rows.map((r) => ({
      eventId: r.id,
      providerEventId: r.provider_event_id,
      sport: r.sport,
      competitionId: r.competition_id,
      providerCompetitionId: r.provider_competition_id,
      seasonId: r.season_id,
      startsAt: asDate(r.starts_at),
      status: r.status,
      statusSource: r.status_source,
      statusDetail: r.status_detail,
      clock: r.clock ?? null,
      score: r.score ?? null,
      lastValidAt: r.last_valid_at ? asDate(r.last_valid_at) : null,
      tier: r.tier == null ? null : Number(r.tier),
      livePriority: asLivePriority(r.live_priority),
      stageKind: r.stage_kind,
      derby: Boolean(r.derby),
      importance: Number(r.importance ?? 0),
      label: r.label,
    }));
  }

  async snapshots(
    provider: string,
    sport: string,
    providerEventIds: readonly string[],
  ): Promise<Map<string, EventSnapshot>> {
    const out = new Map<string, EventSnapshot>();
    if (!providerEventIds.length) return out;
    const ids = await resolveIds(this.db, { provider, sport }, 'event', providerEventIds);
    if (!ids.size) return out;
    const eventIds = [...new Set(ids.values())];
    const rows = await this.db.select().from(event).where(inArray(event.id, eventIds));
    const incidents = await this.db
      .select({
        eventId: eventIncident.eventId,
        sequence: eventIncident.sequence,
        type: eventIncident.type,
        detail: eventIncident.detail,
        minute: eventIncident.minute,
        extra: eventIncident.extra,
        participantId: eventIncident.participantId,
      })
      .from(eventIncident)
      .where(inArray(eventIncident.eventId, eventIds))
      .orderBy(eventIncident.eventId, eventIncident.sequence);
    const byEvent = new Map<string, EventSnapshot['incidents']>();
    for (const i of incidents) {
      const list = byEvent.get(i.eventId) ?? [];
      list.push({
        sequence: i.sequence,
        type: i.type,
        detail: i.detail,
        minute: i.minute,
        extra: i.extra,
        participantId: i.participantId,
      });
      byEvent.set(i.eventId, list);
    }
    const rowById = new Map(rows.map((r) => [r.id, r]));
    for (const [providerEventId, eventId] of ids) {
      const r = rowById.get(eventId);
      if (!r) continue;
      out.set(providerEventId, {
        eventId,
        providerEventId,
        competitionId: r.competitionId,
        seasonId: r.seasonId,
        status: r.status,
        statusDetail: r.statusDetail,
        clock: r.clock ?? null,
        score: r.score ?? null,
        isStale: r.isStale,
        lastValidAt: r.lastValidAt,
        incidents: byEvent.get(eventId) ?? [],
      });
    }
    return out;
  }

  async applyBatch(batch: NormalizedBatch): Promise<void> {
    await upsertBatch(this.db, batch, this.options.upsert ?? {});
  }

  async applyFailure(input: LiveFailureInput): Promise<number> {
    if (!input.providerEventIds.length) return 0;
    const r = await applyProviderFailure(this.db, {
      ...input,
      providerEventIds: [...input.providerEventIds],
    });
    return r.changed;
  }

  async publish(changes: readonly LiveChange[]): Promise<number> {
    if (this.options.publish === false) return 0;
    let n = 0;
    for (const change of changes) {
      await publishChange(this.db, {
        topic: 'live',
        entityType: 'event',
        entityId: change.eventId,
        payload: changePayload(change),
      });
      n += 1;
    }
    return n;
  }

  async onFinished(changes: readonly LiveChange[]): Promise<void> {
    await this.options.onFinished?.(changes);
  }
}
