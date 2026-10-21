import { createHash } from 'node:crypto';
import { ApiSportsError } from './errors.js';
import { API_HOSTS, type ApiSport } from './hosts.js';
import { PlanRules } from './plan.js';
import type { QuotaGovernor } from './quota/governor.js';
import { RateLimiter, systemClock, type Clock } from './rate-limiter.js';
import type { RawStore } from './raw-store.js';
import { normalizeParams, requestHash } from './request-hash.js';
import { ttlFor } from './ttl.js';
import { classifyErrors, type CallRequest, type CallResult, type Envelope, type Outcome } from './types.js';

const PROVIDER = 'api-sports';

export interface ApiSportsClientOptions {
  apiKey: string;
  store: RawStore;
  governor: QuotaGovernor;
  plan?: PlanRules;
  rateLimiter?: RateLimiter;
  fetch?: typeof globalThis.fetch;
  clock?: Clock;
  /** Respostas grandes (fixtures?date=) podem passar de 60 s. */
  timeoutMs?: number;
  /** Chamado quando o fornecedor desloca a janela de temporadas do plano. */
  onPlanChange?: (plan: PlanRules) => void;
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
 * 4. grava o envelope integral em raw.api_response e o desfecho em ops.quota_ledger.
 */
export class ApiSportsClient {
  private readonly plan: PlanRules;
  private readonly limiter: RateLimiter;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly clock: Clock;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiSportsClientOptions) {
    this.plan = options.plan ?? new PlanRules();
    this.clock = options.clock ?? systemClock;
    this.limiter = options.rateLimiter ?? new RateLimiter(this.plan.current.perMinute, this.clock);
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  get planRules(): PlanRules {
    return this.plan;
  }

  async get<T = unknown>(req: CallRequest): Promise<CallResult<T>> {
    const params = normalizeParams(req.params ?? {});
    const hash = requestHash(PROVIDER, req.sport, req.endpoint, params);
    const now = new Date(this.clock.now());

    const maxAge = req.maxAgeMs ?? ttlFor(req.endpoint, params, now);
    if (maxAge > 0) {
      const hit = await this.options.store.findFresh(hash, maxAge, now);
      if (hit) {
        return {
          envelope: hit.body as Envelope<T>,
          source: 'cache',
          requestHash: hash,
          fetchedAt: hit.fetchedAt,
          quotaRemaining: hit.quotaRemaining ?? undefined,
        };
      }
    }

    this.plan.validate(params, now);

    const ticket = await this.options.governor.acquire({
      api: req.sport,
      priority: req.priority,
      endpoint: req.endpoint,
      requestHash: hash,
      jobId: req.jobId,
      critical: req.critical,
    });

    try {
      await this.limiter.take(req.sport);
    } catch (err) {
      await this.options.governor.release(ticket);
      throw err;
    }

    const url = this.buildUrl(req.sport, req.endpoint, params);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { 'x-apisports-key': this.options.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const outcome: Outcome = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'http_error';
      await this.options.governor.settle(ticket, outcome);
      throw new ApiSportsError(outcome, String(err), hash);
    }

    const text = await response.text();
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
    await this.options.governor.settle(ticket, outcome, quotaRemaining);

    if (outcome === 'plan_error' && envelope) {
      const message = JSON.stringify(envelope.errors);
      if (this.plan.learnFromPlanError(message)) this.options.onPlanChange?.(this.plan);
    }
    if (outcome !== 'ok' || !envelope) {
      throw new ApiSportsError(outcome, envelope?.errors ?? text.slice(0, 500), hash);
    }

    return { envelope, source: 'network', requestHash: hash, fetchedAt, quotaRemaining };
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
      limitDay: r.requests?.limit_day ?? this.plan.current.dailyLimit,
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
