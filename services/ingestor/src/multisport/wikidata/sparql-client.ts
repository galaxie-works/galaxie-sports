import { createHash } from 'node:crypto';
import { and, desc, eq, gte } from 'drizzle-orm';
import { apiResponse, type Database } from '@galaxie/db';

/** Endpoint público do Wikidata Query Service (dados CC0). */
export const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

/** User-Agent genérico exigido pela política do WDQS — sem e-mail nem dado pessoal. */
export const DEFAULT_USER_AGENT = 'galaxie-sports/0.1 (multisport loader)';

export interface SparqlTerm {
  type: 'uri' | 'literal' | 'bnode' | 'typed-literal';
  value: string;
  'xml:lang'?: string;
  datatype?: string;
}
export type SparqlBinding = Record<string, SparqlTerm>;
export interface SparqlResponse {
  head: { vars: string[] };
  results: { bindings: SparqlBinding[] };
}

/** Cache das respostas brutas: permite reprocessar sem voltar ao endpoint. */
export interface SparqlCache {
  get(hash: string, maxAgeMs: number | null): Promise<SparqlResponse | null>;
  put(entry: {
    hash: string;
    name: string;
    params: Record<string, string | number>;
    page: number;
    body: SparqlResponse;
    statusCode: number;
  }): Promise<void>;
}

export interface SparqlClientOptions {
  endpoint?: string;
  userAgent?: string;
  fetch?: typeof fetch;
  cache?: SparqlCache;
  /** Intervalo mínimo entre requisições (as consultas são sempre sequenciais). */
  minIntervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** null = reaproveita o cache indefinidamente (edições encerradas mudam pouco). */
  cacheMaxAgeMs?: number | null;
  /** true = ignora o cache na leitura (ainda grava a resposta nova). */
  refresh?: boolean;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface QueryResult {
  data: SparqlResponse;
  fromCache: boolean;
}

export class SparqlError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'SparqlError';
  }
}

export function queryHash(query: string): string {
  return createHash('sha256').update(`wikidata|sparql|${query}`).digest('hex');
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Cliente SPARQL resiliente: sequencial, com intervalo mínimo, novas tentativas com backoff exponencial
 * (respeita Retry-After em 429/503) e cache das respostas brutas.
 */
export class SparqlClient {
  private readonly endpoint: string;
  private readonly userAgent: string;
  private readonly fetchFn: typeof fetch;
  private readonly cache: SparqlCache | undefined;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly cacheMaxAgeMs: number | null;
  private readonly refresh: boolean;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;
  private lastRequestAt = 0;
  /** Requisições efetivamente enviadas ao endpoint (para relatórios). */
  networkCalls = 0;
  cacheHits = 0;

  constructor(options: SparqlClientOptions = {}) {
    this.endpoint = options.endpoint ?? WIKIDATA_SPARQL_ENDPOINT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchFn = options.fetch ?? fetch;
    this.cache = options.cache;
    this.minIntervalMs = options.minIntervalMs ?? 1500;
    this.maxRetries = options.maxRetries ?? 5;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.cacheMaxAgeMs = options.cacheMaxAgeMs ?? null;
    this.refresh = options.refresh ?? false;
    this.sleep = options.sleep ?? defaultSleep;
    this.log = options.log ?? (() => {});
  }

  async query(
    name: string,
    query: string,
    params: Record<string, string | number> = {},
    page = 1,
  ): Promise<QueryResult> {
    const cached = await this.cached(query);
    if (cached) {
      this.cacheHits += 1;
      return { data: cached, fromCache: true };
    }
    return { data: await this.fetchAndStore(name, query, params, page), fromCache: false };
  }

  /** Resposta do cache (respeitando `refresh` e a idade máxima), sem ir à rede. */
  private async cached(query: string): Promise<SparqlResponse | null> {
    if (!this.cache || this.refresh) return null;
    return this.cache.get(queryHash(query), this.cacheMaxAgeMs);
  }

  private async fetchAndStore(
    name: string,
    query: string,
    params: Record<string, string | number>,
    page: number,
  ): Promise<SparqlResponse> {
    const data = await this.fetchWithRetry(name, query);
    if (this.cache)
      await this.cache.put({ hash: queryHash(query), name, params, page, body: data, statusCode: 200 });
    return data;
  }

  /**
   * Pagina com LIMIT/OFFSET até vir uma página incompleta. A consulta deve ter ORDER BY estável. As páginas vêm
   * todas do cache ou todas da rede: misturar a página 1 de uma semana atrás com a 2 de agora desloca o OFFSET
   * (linhas novas ou removidas no meio) e perde ou repete linhas. Faltou uma página no cache: busca todas de novo.
   */
  async paginate(
    name: string,
    build: (limit: number, offset: number) => string,
    params: Record<string, string | number>,
    pageSize: number,
    maxPages = 200,
  ): Promise<SparqlBinding[]> {
    const fromCache: SparqlBinding[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const data = await this.cached(build(pageSize, (page - 1) * pageSize));
      if (!data) break;
      fromCache.push(...data.results.bindings);
      if (data.results.bindings.length < pageSize) {
        this.cacheHits += page;
        return fromCache;
      }
    }
    const all: SparqlBinding[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const offset = (page - 1) * pageSize;
      const data = await this.fetchAndStore(name, build(pageSize, offset), { ...params, offset }, page);
      const rows = data.results.bindings;
      all.push(...rows);
      if (rows.length < pageSize) return all;
    }
    throw new SparqlError(`Paginação de "${name}" excedeu ${maxPages} páginas`, null);
  }

  private async fetchWithRetry(name: string, query: string): Promise<SparqlResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
      this.networkCalls += 1;
      let retryAfterMs: number | null = null;
      try {
        const res = await this.fetchFn(this.endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/sparql-results+json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': this.userAgent,
          },
          body: new URLSearchParams({ query }).toString(),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) return (await res.json()) as SparqlResponse;
        const text = (await res.text()).slice(0, 300);
        const retryable = res.status === 429 || res.status >= 500;
        lastError = new SparqlError(`WDQS respondeu ${res.status} em "${name}": ${text}`, res.status);
        if (!retryable) throw lastError;
        const header = res.headers.get('retry-after');
        if (header && /^\d+$/.test(header)) retryAfterMs = Number(header) * 1000;
      } catch (err) {
        if (err instanceof SparqlError && err.status !== null && err.status < 500 && err.status !== 429)
          throw err;
        lastError = err;
      }
      if (attempt === this.maxRetries) break;
      const backoff = retryAfterMs ?? Math.min(60_000, 2000 * 2 ** attempt);
      this.log(
        `  "${name}": tentativa ${attempt + 1} falhou; nova tentativa em ${Math.round(backoff / 1000)} s`,
      );
      await this.sleep(backoff);
    }
    throw lastError instanceof Error ? lastError : new SparqlError(String(lastError), null);
  }
}

/** Cache em raw.api_response (provider "wikidata"): o mesmo bronze usado para a api-sports. */
export class PgSparqlCache implements SparqlCache {
  constructor(
    private readonly db: Database,
    private readonly jobId = 'multisport:wikidata',
  ) {}

  async get(hash: string, maxAgeMs: number | null): Promise<SparqlResponse | null> {
    const conditions = [eq(apiResponse.provider, 'wikidata'), eq(apiResponse.requestHash, hash)];
    if (maxAgeMs !== null) conditions.push(gte(apiResponse.fetchedAt, new Date(Date.now() - maxAgeMs)));
    const [row] = await this.db
      .select({ body: apiResponse.body })
      .from(apiResponse)
      .where(and(...conditions))
      .orderBy(desc(apiResponse.fetchedAt))
      .limit(1);
    return (row?.body as SparqlResponse | undefined) ?? null;
  }

  async put(entry: {
    hash: string;
    name: string;
    params: Record<string, string | number>;
    page: number;
    body: SparqlResponse;
    statusCode: number;
  }): Promise<void> {
    const text = JSON.stringify(entry.body);
    await this.db.insert(apiResponse).values({
      provider: 'wikidata',
      sport: 'multisport',
      apiVersion: 'sparql',
      endpoint: `/sparql/${entry.name}`,
      params: entry.params,
      requestHash: entry.hash,
      page: entry.page,
      statusCode: entry.statusCode,
      results: entry.body.results.bindings.length,
      errors: null,
      body: entry.body,
      bodyHash: createHash('sha256').update(text).digest('hex'),
      quotaRemaining: null,
      jobId: this.jobId,
    });
  }
}
