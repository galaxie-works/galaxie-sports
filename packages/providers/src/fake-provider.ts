import type { NormalizedBatch } from './model.js';
import {
  batchResult,
  type CallOptions,
  type EventListQuery,
  type ParticipantListQuery,
  type ProviderError,
  type ProviderResult,
  type SportsDataProvider,
} from './provider.js';

export type FakeMethod =
  | 'listCompetitions'
  | 'listEvents'
  | 'getEventDetail'
  | 'listLive'
  | 'listParticipants'
  | 'listSquad'
  | 'listCoaches'
  | 'listStandings';

export interface FakeCall {
  method: FakeMethod;
  args: unknown[];
}

/**
 * Provedor em memória para testes e demonstrações: devolve, em ordem, os resultados enfileirados
 * por método (`ok` com um lote, `empty` ou `error`). Prova que o core aceita qualquer provedor que
 * fale o modelo neutro.
 */
export class FakeProvider implements SportsDataProvider {
  readonly calls: FakeCall[] = [];
  private readonly queues = new Map<FakeMethod, ProviderResult[]>();

  constructor(
    readonly id: string,
    private readonly sports: readonly string[] = ['football'],
  ) {}

  supports(sport: string): boolean {
    return this.sports.includes(sport);
  }

  /** Enfileira um lote (vira `ok` ou `empty` conforme tenha eventos/entidades). */
  willReturn(method: FakeMethod, batch: NormalizedBatch): this {
    const items =
      batch.events.length +
      batch.participants.length +
      batch.persons.length +
      batch.standings.length +
      batch.competitions.length;
    return this.enqueue(method, batchResult(batch, 'network', items));
  }

  willFail(method: FakeMethod, error: ProviderError, at: Date): this {
    return this.enqueue(method, { status: 'error', error, fetchedAt: at });
  }

  enqueue(method: FakeMethod, result: ProviderResult): this {
    const q = this.queues.get(method) ?? [];
    q.push(result);
    this.queues.set(method, q);
    return this;
  }

  private async next(method: FakeMethod, args: unknown[]): Promise<ProviderResult> {
    this.calls.push({ method, args });
    const result = this.queues.get(method)?.shift();
    if (!result) throw new Error(`FakeProvider(${this.id}): nenhuma resposta enfileirada para ${method}`);
    return result;
  }

  listCompetitions(sport: string, options?: CallOptions) {
    return this.next('listCompetitions', [sport, options]);
  }
  listEvents(query: EventListQuery, options?: CallOptions) {
    return this.next('listEvents', [query, options]);
  }
  getEventDetail(sport: string, eventId: string, options?: CallOptions) {
    return this.next('getEventDetail', [sport, eventId, options]);
  }
  listLive(sport: string, competitionIds?: string[], options?: CallOptions) {
    return this.next('listLive', [sport, competitionIds, options]);
  }
  listParticipants(query: ParticipantListQuery, options?: CallOptions) {
    return this.next('listParticipants', [query, options]);
  }
  listSquad(sport: string, participantId: string, options?: CallOptions) {
    return this.next('listSquad', [sport, participantId, options]);
  }
  listCoaches(sport: string, participantId: string, options?: CallOptions) {
    return this.next('listCoaches', [sport, participantId, options]);
  }
  listStandings(sport: string, competitionId: string, season: number, options?: CallOptions) {
    return this.next('listStandings', [sport, competitionId, season, options]);
  }
}
