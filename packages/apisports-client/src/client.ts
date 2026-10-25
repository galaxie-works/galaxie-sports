import { createHash } from 'node:crypto';
import { ApiSportsError, OfflineMissError, RequestInFlightError } from './errors.js';
import { API_HOSTS, type ApiSport } from './hosts.js';
import { PlanRules } from './plan.js';
import type { QuotaGovernor, QuotaTicket } from './quota/governor.js';
import { RateLimiter, systemClock, type Clock } from './rate-limiter.js';
import type { RawStore } from './raw-store.js';
import { normalizeParams, requestHash } from './request-hash.js';
import { FOREVER, ttlFor } from './ttl.js';
import { classifyErrors, type CallRequest, type CallResult, type Envelope, type Outcome } from './types.js';

const PROVIDER = 'api-sports';
/** Intervalo de checagem do raw enquanto outro processo busca a mesma requisição. */
const IN_FLIGHT_POLL_MS = 1_000;

export interface ApiSportsClientOptions {
  apiKey: string;
  store: RawStore;
  governor: QuotaGovernor;
  /** Mesmas regras de plano para todas as APIs (compatibilidade). Prefira `planFor`. */
  plan?: PlanRules;
  /**
   * Regras de plano por API (cada API tem assinatura própria). Chamado uma vez por esporte; o resultado
   * fica em cache no cliente (PlanRules aprende a janela de temporadas por API). Tem precedência sobre `plan`.
   */
  planFor?: (sport: ApiSport) => PlanRules;
  /**
   * Limitador compartilhado (as chaves já são por API). Sem ele, o cliente cria um limitador por API
   * com o `perMinute` do plano daquela API.
   */
  rateLimiter?: RateLimiter;
  fetch?: typeof globalThis.fetch;
  clock?: Clock;
  /** Respostas grandes (fixtures?date=) podem passar de 60 s. */
  timeoutMs?: number;
  /** Chamado quando o fornecedor desloca a janela de temporadas do plano de uma API. */
  onPlanChange?: (plan: PlanRules, sport: ApiSport) => void;
  /**
   * Modo offline (ambiente local sem chave, ex.: após restaurar um snapshot do raw): serve a resposta
   * mais recente do raw, de qualquer idade, e nunca chama o fornecedor (OfflineMissError).
   */
  offline?: boolean;
  /** Observador de cada requisição resolvida (cache ou rede) — usado para logs estruturados. */
  onCall?: (event: CallEvent) => void;
}

/** Uma requisição resolvida pelo cliente, para logs (`job_id`, `sport`, `endpoint`...). */
export interface CallEvent {
  sport: ApiSport;
  endpoint: string;
  priority: CallRequest['priority'];
  jobId?: string | undefined;
  requestHash: string;
  /** `cache` = servido do raw (0 cota); `network` = chamada real ao fornecedor. */
  source: 'cache' | 'network';
  /** Desfecho registrado no ledger (só para `network`). */
  outcome?: Outcome | undefined;
  statusCode?: number | undefined;
  quotaRemaining?: number | undefined;
  durationMs: number;
}

export interface ProviderStatus {
  plan: string | null;
  active: boolean | null;
  end: string | null;
  used: number;
  limitDay: number;
}

/**
 * Cliente único das 12 APIs da api-sports. Toda chamada:
 * 1. reaproveita o raw se houver resposta fresca (TTL por endpoint) — sem gastar cota;
 * 2. é pré-validada contra as restrições do plano;
 * 3. reserva cota no Quota Governor e respeita o limite por minuto;
 *    pedidos idênticos simultâneos (no processo ou entre processos) geram uma única chamada;
 * 4. grava o envelope integral em raw.api_response e o desfecho em ops.quota_ledger.
 */
export class ApiSportsClient {
  private readonly rules = new Map<ApiSport, PlanRules>();
  private readonly limiters = new Map<ApiSport, RateLimiter>();
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly clock: Clock;
  private readonly timeoutMs: number;
  private readonly inFlight = new Map<string, Promise<CallResult<unknown>>>();

  constructor(private readonly options: ApiSportsClientOptions) {
    this.clock = options.clock ?? systemClock;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  /** Regras do plano do futebol (API principal). Para as demais APIs, use `planRulesFor(sport)`. */
  get planRules(): PlanRules {
    return this.planRulesFor('football');
  }

  /** Regras do plano de uma API (criadas na primeira consulta e reaproveitadas). */
  planRulesFor(sport: ApiSport): PlanRules {
    let rules = this.rules.get(sport);
    if (!rules) {
      rules = this.options.planFor?.(sport) ?? this.options.plan ?? new PlanRules();
      this.rules.set(sport, rules);
    }
    return rules;
  }

  /** Limitador por minuto de uma API: o compartilhado, se informado, ou um com o `perMinute` do plano dela. */
  private limiterFor(sport: ApiSport): RateLimiter {
    if (this.options.rateLimiter) return this.options.rateLimiter;
    let limiter = this.limiters.get(sport);
    if (!limiter) {
      limiter = new RateLimiter(this.planRulesFor(sport).current.perMinute, this.clock);
      this.limiters.set(sport, limiter);
    }
    return limiter;
  }

  get offline(): boolean {
    return this.options.offline ?? false;
  }

  async get<T = unknown>(req: CallRequest): Promise<CallResult<T>> {
    const params = normalizeParams(req.params ?? {});
    const hash = requestHash(PROVIDER, req.sport, req.endpoint, params);
    const startedAt = this.clock.now();
    const now = new Date(startedAt);

    if (this.options.offline) {
      const hit = await this.fromCache<T>(req, hash, FOREVER, now);
      if (hit) {
        this.emit(req, hash, { source: 'cache', durationMs: this.clock.now() - startedAt });
        return hit;
      }
      throw new OfflineMissError(req.endpoint, params);
    }

    const maxAge = req.maxAgeMs ?? ttlFor(req.endpoint, params, now);
    if (maxAge > 0) {
      const hit = await this.fromCache<T>(req, hash, maxAge, now);
      if (hit) {
        this.emit(req, hash, { source: 'cache', durationMs: this.clock.now() - startedAt });
        return hit;
      }
    }

    this.planRulesFor(req.sport).validate(params, now);

    // Mesmo processo: pedidos idênticos simultâneos compartilham a mesma chamada.
    const pending = this.inFlight.get(hash);
    if (pending) return pending as Promise<CallResult<T>>;
    const call = this.fetchOnce<T>(req, params, hash, maxAge).finally(() => this.inFlight.delete(hash));
    this.inFlight.set(hash, call);
    return call;
  }

  private async fromCache<T>(
    req: CallRequest,
    hash: string,
    maxAge: number,
    now: Date,
  ): Promise<CallResult<T> | undefined> {
    const hit = await this.options.store.findFresh(hash, maxAge, now, {
      provider: PROVIDER,
      sport: req.sport,
      endpoint: req.endpoint,
    });
    if (!hit) return undefined;
    return {
      envelope: hit.body as Envelope<T>,
      source: 'cache',
      requestHash: hash,
      fetchedAt: hit.fetchedAt,
      quotaRemaining: hit.quotaRemaining ?? undefined,
    };
  }

  private async fetchOnce<T>(
    req: CallRequest,
    params: Record<string, string>,
    hash: string,
    maxAge: number,
  ): Promise<CallResult<T>> {
    const startedAt = this.clock.now();
    let ticket: QuotaTicket;
    for (;;) {
      try {
        ticket = await this.options.governor.acquire({
          api: req.sport,
          priority: req.priority,
          endpoint: req.endpoint,
          requestHash: hash,
          jobId: req.jobId,
          critical: req.critical,
        });
        break;
      } catch (err) {
        if (!(err instanceof RequestInFlightError)) throw err;
        // Outro processo está buscando exatamente isto: espera o resultado dele aparecer no raw.
        await this.clock.sleep(IN_FLIGHT_POLL_MS);
        const now = this.clock.now();
        const window = maxAge > 0 ? maxAge : now - startedAt + IN_FLIGHT_POLL_MS;
        const hit = await this.fromCache<T>(req, hash, window, new Date(now));
        if (hit) {
          this.emit(req, hash, { source: 'cache', durationMs: this.clock.now() - startedAt });
          return hit;
        }
        if (now - startedAt > this.timeoutMs) throw err;
      }
    }

    try {
      await this.limiterFor(req.sport).take(req.sport);
    } catch (err) {
      await this.options.governor.release(ticket);
      throw err;
    }

    const url = this.buildUrl(req.sport, req.endpoint, params);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(url, {
        headers: { 'x-apisports-key': this.options.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      // o timeout vale também para a leitura do corpo, que pode falhar depois do status
      text = await response.text();
    } catch (err) {
      const outcome: Outcome = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'http_error';
      await this.options.governor.settle(ticket, outcome);
      this.emit(req, hash, { source: 'network', outcome, durationMs: this.clock.now() - startedAt });
      throw new ApiSportsError(outcome, String(err), hash);
    }

    const quotaRemaining = toInt(response.headers.get('x-ratelimit-requests-remaining'));
    let envelope: Envelope<T> | undefined;
    try {
      envelope = JSON.parse(text) as Envelope<T>;
    } catch {
      envelope = undefined;
    }

    let outcome: Outcome;
    if (response.status === 429) outcome = 'rate_limited';
    else if (!response.ok || !envelope) outcome = 'http_error';
    else outcome = classifyErrors(envelope.errors);

    const fetchedAt = new Date(this.clock.now());
    try {
      await this.options.store.save({
        provider: PROVIDER,
        sport: req.sport,
        apiVersion: API_HOSTS[req.sport].version,
        endpoint: req.endpoint,
        params,
        requestHash: hash,
        page: Number(params.page ?? 1),
        statusCode: response.status,
        results: envelope?.results ?? null,
        errors: envelope?.errors ?? { http: `HTTP ${response.status}` },
        body: envelope ?? { raw: text.slice(0, 10_000) },
        bodyHash: createHash('sha256').update(text).digest('hex'),
        quotaRemaining: quotaRemaining ?? null,
        jobId: req.jobId ?? null,
        fetchedAt,
      });
    } finally {
      // A chamada foi feita: o ticket nunca fica pending, mesmo se a gravação do raw falhar.
      // O settle vem depois do save para quem espera a mesma requisição já encontrar o raw.
      await this.options.governor.settle(ticket, outcome, quotaRemaining);
    }
    this.emit(req, hash, {
      source: 'network',
      outcome,
      statusCode: response.status,
      quotaRemaining,
      durationMs: fetchedAt.getTime() - startedAt,
    });

    if (outcome === 'plan_error' && envelope) {
      const message = JSON.stringify(envelope.errors);
      const rules = this.planRulesFor(req.sport);
      if (rules.learnFromPlanError(message)) this.options.onPlanChange?.(rules, req.sport);
    }
    if (outcome !== 'ok' || !envelope) {
      throw new ApiSportsError(outcome, envelope?.errors ?? text.slice(0, 500), hash);
    }

    return { envelope, source: 'network', requestHash: hash, fetchedAt, quotaRemaining };
  }

  /** Notifica o observador (logs); uma falha no observador nunca derruba a chamada. */
  private emit(
    req: CallRequest,
    hash: string,
    detail: Pick<CallEvent, 'source' | 'durationMs'> & Partial<CallEvent>,
  ): void {
    if (!this.options.onCall) return;
    try {
      this.options.onCall({
        sport: req.sport,
        endpoint: req.endpoint,
        priority: req.priority,
        jobId: req.jobId,
        requestHash: hash,
        ...detail,
      });
    } catch {
      // observador com defeito não afeta a ingestão
    }
  }

  /** Percorre todas as páginas (cada página é uma requisição na cota). */
  async getAllPages<T = unknown>(req: CallRequest): Promise<CallResult<T[]>[]> {
    const pages: CallResult<T[]>[] = [];
    let page = 1;
    for (;;) {
      const result = await this.get<T[]>({ ...req, params: { ...req.params, page } });
      pages.push(result);
      const total = result.envelope.paging?.total ?? 1;
      if (page >= total) return pages;
      page += 1;
    }
  }

  /** /status não consome cota: consulta o contador do fornecedor e reconcilia o Governor. */
  async status(sport: ApiSport): Promise<ProviderStatus> {
    const res = await this.fetchFn(`${API_HOSTS[sport].base}/status`, {
      headers: { 'x-apisports-key': this.options.apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json()) as {
      response?: {
        subscription?: { plan?: string; active?: boolean; end?: string };
        requests?: { current?: number; limit_day?: number };
      };
    };
    const r = body.response ?? {};
    const status: ProviderStatus = {
      plan: r.subscription?.plan ?? null,
      active: r.subscription?.active ?? null,
      end: r.subscription?.end ?? null,
      used: r.requests?.current ?? 0,
      limitDay: r.requests?.limit_day ?? this.planRulesFor(sport).current.dailyLimit,
    };
    await this.options.governor.reconcile(sport, status.used, status.limitDay, status.plan ?? undefined);
    return status;
  }

  private buildUrl(sport: ApiSport, endpoint: string, params: Record<string, string>): string {
    const qs = new URLSearchParams(params).toString();
    return `${API_HOSTS[sport].base}${endpoint}${qs ? `?${qs}` : ''}`;
  }
}

function toInt(v: string | null): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
