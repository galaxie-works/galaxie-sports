/**
 * `LiveStore` em memória com a mesma semântica do core (máquina de estados e *last-known-good* de
 * `@galaxie/providers`): usado nos testes e na simulação de dias inteiros, sem banco.
 */
import {
  applyObservation,
  expectedEnd,
  tick,
  type EventState,
  type FailureReason,
  type NormalizedBatch,
} from '@galaxie/providers';
import type { EventSnapshot, IncidentSnapshot, LiveChange } from './diff.js';
import type { LiveFailureInput, LiveStore } from './store.js';
import type { LiveCandidate } from './types.js';

export interface SeedEvent extends Omit<
  LiveCandidate,
  'status' | 'statusDetail' | 'clock' | 'score' | 'lastValidAt' | 'providerEventId' | 'eventId'
> {
  eventId?: string;
  providerEventId: string;
}

interface Row {
  meta: SeedEvent & { eventId: string };
  state: EventState;
  incidents: IncidentSnapshot[];
}

export class InMemoryLiveStore implements LiveStore {
  private readonly rows = new Map<string, Row>();
  readonly published: LiveChange[] = [];
  readonly finished: LiveChange[] = [];
  readonly failures: { at: Date; reason: FailureReason; changed: number }[] = [];
  /** Lotes aplicados (inspeção nos testes). */
  batches = 0;

  seed(events: readonly SeedEvent[]): this {
    for (const e of events) {
      const eventId = e.eventId ?? `ev-${e.providerEventId}`;
      this.rows.set(e.providerEventId, {
        meta: { ...e, eventId },
        state: {
          status: 'scheduled',
          statusDetail: 'NS',
          statusSource: 'provider',
          clock: null,
          score: null,
          startsAt: e.startsAt,
          endsAtExpected: expectedEnd({ sport: e.sport, startsAt: e.startsAt }),
          lastValidAt: null,
          isStale: false,
        },
        incidents: [],
      });
    }
    return this;
  }

  /** Estado atual (inspeção nos testes). */
  state(providerEventId: string): EventState | undefined {
    return this.rows.get(providerEventId)?.state;
  }

  private candidate(row: Row): LiveCandidate {
    const { meta, state } = row;
    return {
      ...meta,
      eventId: meta.eventId,
      providerEventId: meta.providerEventId,
      startsAt: state.startsAt,
      status: state.status,
      statusSource: state.statusSource,
      statusDetail: state.statusDetail,
      clock: state.clock,
      score: state.score,
      lastValidAt: state.lastValidAt,
    };
  }

  async candidates(sport: string, _provider: string, from: Date, to: Date): Promise<LiveCandidate[]> {
    const dayBefore = from.getTime() - 86_400_000;
    return [...this.rows.values()]
      .filter((r) => {
        const t = r.state.startsAt.getTime();
        if (r.meta.sport !== sport || t >= to.getTime()) return false;
        return (
          t >= from.getTime() || (['live', 'break', 'suspended'].includes(r.state.status) && t >= dayBefore)
        );
      })
      .map((r) => this.candidate(r))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.eventId < b.eventId ? -1 : 1));
  }

  /** Relógio dos eventos (como o `advanceEventClock` do core): avança pelo horário quem está sem dado fresco. */
  advanceClock(now: Date): number {
    let changed = 0;
    for (const r of this.rows.values()) {
      const step = tick(r.state, now);
      if (!step.changed) continue;
      r.state = step.state;
      changed += 1;
    }
    return changed;
  }

  async snapshots(
    _provider: string,
    _sport: string,
    providerEventIds: readonly string[],
  ): Promise<Map<string, EventSnapshot>> {
    const out = new Map<string, EventSnapshot>();
    for (const id of providerEventIds) {
      const r = this.rows.get(id);
      if (!r) continue;
      out.set(id, {
        eventId: r.meta.eventId,
        providerEventId: id,
        competitionId: r.meta.competitionId,
        seasonId: r.meta.seasonId,
        status: r.state.status,
        statusDetail: r.state.statusDetail,
        clock: r.state.clock,
        score: r.state.score,
        isStale: r.state.isStale,
        lastValidAt: r.state.lastValidAt,
        incidents: r.incidents.map((i) => ({ ...i })),
      });
    }
    return out;
  }

  async applyBatch(batch: NormalizedBatch): Promise<void> {
    this.batches += 1;
    for (const e of batch.events) {
      const r = this.rows.get(e.id);
      if (!r) continue;
      const step = applyObservation(r.state, e.observation);
      if (step.ignored) continue;
      r.state = step.state;
      if (e.incidents) {
        r.incidents = e.incidents.map((i) => ({
          sequence: i.sequence,
          type: i.type,
          detail: i.detail,
          minute: i.minute,
          extra: i.extra,
          participantId: i.participantId,
        }));
      }
    }
  }

  async applyFailure(input: LiveFailureInput): Promise<number> {
    let changed = 0;
    for (const id of input.providerEventIds) {
      const r = this.rows.get(id);
      if (!r) continue;
      const step = applyObservation(r.state, { kind: 'failure', observedAt: input.at, reason: input.reason });
      if (step.changed) changed += 1;
      r.state = step.state;
    }
    this.failures.push({ at: input.at, reason: input.reason, changed });
    return changed;
  }

  async publish(changes: readonly LiveChange[]): Promise<number> {
    this.published.push(...changes);
    return changes.length;
  }

  async onFinished(changes: readonly LiveChange[]): Promise<void> {
    this.finished.push(...changes);
  }
}
