/**
 * Camada de provedores plugável (ADR-09, docs/03 §8).
 *
 * Cada provedor (api-sports, um provedor licenciado, o provedor do próprio cliente, fontes
 * multiesportivas) implementa `SportsDataProvider`: busca no seu formato, grava o próprio raw e
 * devolve um `NormalizedBatch` neutro. O core, a semântica, o onde assistir e a API /v1 só
 * enxergam o lote normalizado — trocar o provedor não muda contrato nenhum.
 */
import type { FailureReason } from './event/state-machine.js';
import type { NormalizedBatch } from './model.js';

/** Prioridade de cota da chamada (Quota Governor); provedores sem cota diária podem ignorar. */
export type CallPriority = 'BOOTSTRAP' | 'DAILY' | 'LIVE' | 'ADHOC';

export interface CallOptions {
  priority?: CallPriority;
  jobId?: string;
}

export type ProviderErrorKind = FailureReason;

export interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  /** Vale tentar de novo mais tarde (5xx, timeout, limite por minuto). */
  retryable: boolean;
}

/**
 * Resultado de uma consulta:
 * - `ok`: dados válidos;
 * - `empty`: resposta válida, mas sem itens (pode ser "nada novo" ou "fora da assinatura");
 * - `error`: a fonte falhou ou a chamada foi bloqueada antes de sair (cota, plano).
 * Em `empty` e `error` o chamador mantém o último estado válido (docs/04 §3.1, regra 1).
 */
export type ProviderResult =
  | { status: 'ok'; batch: NormalizedBatch; fetchedAt: Date; source: 'cache' | 'network' }
  | { status: 'empty'; batch: NormalizedBatch; fetchedAt: Date; source: 'cache' | 'network' }
  | { status: 'error'; error: ProviderError; fetchedAt: Date };

export type EventListQuery =
  | { sport: string; competitionId: string; season: number }
  | { sport: string; date: string }
  | { sport: string; participantIds: [string, string] };

export type ParticipantListQuery =
  { sport: string; competitionId: string; season: number } | { sport: string; country: string };

export interface SportsDataProvider {
  /** Identificador gravado em `raw.api_response.provider` e `core.provider_map.provider`. */
  readonly id: string;
  supports(sport: string): boolean;

  /** Catálogo: competições e temporadas. */
  listCompetitions(sport: string, options?: CallOptions): Promise<ProviderResult>;
  /** Agenda/resultados de uma temporada, de um dia ou de um confronto (h2h). */
  listEvents(query: EventListQuery, options?: CallOptions): Promise<ProviderResult>;
  /** Partida completa: timeline, escalações, estatísticas, jogadores. */
  getEventDetail(sport: string, eventId: string, options?: CallOptions): Promise<ProviderResult>;
  /** Tudo o que está ao vivo agora (opcionalmente só de algumas competições). */
  listLive(sport: string, competitionIds?: string[], options?: CallOptions): Promise<ProviderResult>;
  /** Times/participantes com estádio. */
  listParticipants(query: ParticipantListQuery, options?: CallOptions): Promise<ProviderResult>;
  /** Elenco atual de um participante. */
  listSquad(sport: string, participantId: string, options?: CallOptions): Promise<ProviderResult>;
  /** Comissão técnica atual de um participante. */
  listCoaches(sport: string, participantId: string, options?: CallOptions): Promise<ProviderResult>;
  /** Tabela(s) de classificação de uma temporada. */
  listStandings(
    sport: string,
    competitionId: string,
    season: number,
    options?: CallOptions,
  ): Promise<ProviderResult>;
}

/** Monta um resultado `ok`/`empty` a partir de um lote. */
export function batchResult(
  batch: NormalizedBatch,
  source: 'cache' | 'network',
  items: number,
): ProviderResult {
  return items > 0
    ? { status: 'ok', batch, fetchedAt: batch.observedAt, source }
    : { status: 'empty', batch, fetchedAt: batch.observedAt, source };
}

/** Lança quando um provedor não implementa uma consulta para o esporte pedido. */
export class UnsupportedQueryError extends Error {
  constructor(provider: string, what: string) {
    super(`Provedor ${provider} não suporta ${what}`);
    this.name = 'UnsupportedQueryError';
  }
}
