import {
  ApiSportsError,
  PlanViolationError,
  QuotaExceededError,
  RequestInFlightError,
  type ApiSportsClient,
  type CallRequest,
} from '@galaxie/apisports-client';
import { emptyBatch } from '../model.js';
import {
  batchResult,
  UnsupportedQueryError,
  type CallOptions,
  type EventListQuery,
  type ParticipantListQuery,
  type ProviderError,
  type ProviderResult,
  type SportsDataProvider,
} from '../provider.js';
import {
  API_SPORTS_PROVIDER,
  normalizeFootballEnvelope,
  normalizeLeagues,
  type ApiLeagueItem,
} from './football/normalize.js';

/** Subconjunto do `ApiSportsClient` usado pelo provedor (facilita testes com cliente falso). */
export type ApiSportsGetter = Pick<ApiSportsClient, 'get'>;

/** Traduz as exceções do cliente da api-sports em erro neutro de provedor. */
export function classifyApiSportsError(err: unknown): ProviderError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof ApiSportsError) {
    switch (err.outcome) {
      case 'plan_error':
        return { kind: 'plan', message, retryable: false };
      case 'rate_limited':
        return { kind: 'rate_limited', message, retryable: true };
      case 'quota_exhausted':
        return { kind: 'quota', message, retryable: false };
      case 'auth_error':
        return { kind: 'auth', message, retryable: false };
      case 'timeout':
        return { kind: 'timeout', message, retryable: true };
      default:
        return { kind: 'http_error', message, retryable: true };
    }
  }
  if (err instanceof PlanViolationError) return { kind: 'plan', message, retryable: false };
  if (err instanceof QuotaExceededError) return { kind: 'quota', message, retryable: false };
  if (err instanceof RequestInFlightError) return { kind: 'rate_limited', message, retryable: true };
  return { kind: 'http_error', message, retryable: true };
}

/**
 * Primeiro provedor da camada plugável: api-sports football v3 via `ApiSportsClient`
 * (cache no raw, plano, Quota Governor). Toda resposta já fica em `raw.api_response`
 * com `provider = 'api-sports'`; aqui só traduzimos para o lote neutro.
 */
export class ApiSportsProvider implements SportsDataProvider {
  readonly id = API_SPORTS_PROVIDER;

  constructor(
    private readonly client: ApiSportsGetter,
    private readonly defaults: CallOptions = { priority: 'ADHOC' },
    private readonly now: () => Date = () => new Date(),
  ) {}

  supports(sport: string): boolean {
    return sport === 'football';
  }

  private assertSport(sport: string, what: string): void {
    if (!this.supports(sport)) throw new UnsupportedQueryError(this.id, `${what} de ${sport}`);
  }

  private async call(
    endpoint: string,
    params: Record<string, string | number>,
    options: CallOptions | undefined,
  ): Promise<ProviderResult> {
    const opts = { ...this.defaults, ...options };
    const req: CallRequest = {
      sport: 'football',
      endpoint,
      params,
      priority: opts.priority ?? 'ADHOC',
      ...(opts.jobId ? { jobId: opts.jobId } : {}),
      ...(opts.critical ? { critical: true } : {}),
    };
    try {
      const res = await this.client.get(req);
      const stringParams = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
      const normalized =
        endpoint === '/leagues'
          ? (() => {
              const items = Array.isArray(res.envelope.response)
                ? (res.envelope.response as ApiLeagueItem[])
                : [];
              return { batch: normalizeLeagues(items, res.fetchedAt), items: items.length };
            })()
          : normalizeFootballEnvelope(endpoint, res.envelope, res.fetchedAt, stringParams);
      if (!normalized) throw new UnsupportedQueryError(this.id, endpoint);
      return batchResult(normalized.batch, res.source, normalized.items);
    } catch (err) {
      if (err instanceof UnsupportedQueryError) throw err;
      return { status: 'error', error: classifyApiSportsError(err), fetchedAt: this.now() };
    }
  }

  listCompetitions(sport: string, options?: CallOptions): Promise<ProviderResult> {
    this.assertSport(sport, 'competições');
    return this.call('/leagues', {}, options);
  }

  listEvents(query: EventListQuery, options?: CallOptions): Promise<ProviderResult> {
    this.assertSport(query.sport, 'eventos');
    if ('date' in query) return this.call('/fixtures', { date: query.date }, options);
    if ('participantIds' in query)
      return this.call('/fixtures/headtohead', { h2h: query.participantIds.join('-') }, options);
    return this.call('/fixtures', { league: query.competitionId, season: query.season }, options);
  }

  getEventDetail(sport: string, eventId: string, options?: CallOptions): Promise<ProviderResult> {
    this.assertSport(sport, 'detalhe de evento');
    return this.call('/fixtures', { id: eventId }, options);
  }

  listLive(sport: string, competitionIds?: string[], options?: CallOptions): Promise<ProviderResult> {
    this.assertSport(sport, 'ao vivo');
    const live = competitionIds?.length ? competitionIds.join('-') : 'all';
    return this.call('/fixtures', { live }, { priority: 'LIVE', ...options });
  }

  listParticipants(query: ParticipantListQuery, options?: CallOptions): Promise<ProviderResult> {
    this.assertSport(query.sport, 'participantes');
    if ('country' in query) return this.call('/teams', { country: query.country }, options);
    return this.call('/teams', { league: query.competitionId, season: query.season }, options);
  }

  listSquad(sport: string, participantId: string, options?: CallOptions): Promise<ProviderResult> {
    this.assertSport(sport, 'elenco');
    return this.call('/players/squads', { team: participantId }, options);
  }

  listCoaches(sport: string, participantId: string, options?: CallOptions): Promise<ProviderResult> {
    this.assertSport(sport, 'técnicos');
    return this.call('/coachs', { team: participantId }, options);
  }

  listStandings(
    sport: string,
    competitionId: string,
    season: number,
    options?: CallOptions,
  ): Promise<ProviderResult> {
    this.assertSport(sport, 'classificação');
    return this.call('/standings', { league: competitionId, season }, options);
  }
}

/** Lote vazio da api-sports (útil em testes e para resultados sem dados). */
export function emptyApiSportsBatch(observedAt: Date) {
  return emptyBatch(API_SPORTS_PROVIDER, 'football', observedAt);
}
