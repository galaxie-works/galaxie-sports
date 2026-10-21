import type { RawRecord } from '@galaxie/apisports-client';
import type { Database } from '@galaxie/db';

/** Consulta ao raw: endpoint + filtros sobre os parâmetros normalizados da requisição. */
export interface RawQuery {
  sport: string;
  endpoint: string;
  /** Parâmetros que precisam estar presentes. */
  has?: string[] | undefined;
  /** Parâmetros que não podem estar presentes. */
  lacks?: string[] | undefined;
  /** Igualdade exata de parâmetros. */
  where?: Record<string, string> | undefined;
}

export interface RawEntry {
  params: Record<string, string>;
  response: unknown;
  paging: { current: number; total: number } | null;
  fetchedAt: Date;
}

/**
 * Leitura do raw pelos jobs (zero cota): os planos de chamadas dependentes (detalhe de partidas,
 * pessoas, h2h) são montados a partir do que já foi baixado.
 */
export interface RawSource {
  /** Resposta de sucesso mais recente de cada requisição distinta que casa com a consulta. */
  latest(query: RawQuery): AsyncIterable<RawEntry>;
  /** Momento da resposta de sucesso mais recente por request hash (para o `--plan`: cache × rede). */
  lastFetched(hashes: string[]): Promise<Map<string, Date>>;
}

function isSuccess(r: Pick<RawRecord, 'statusCode' | 'errors'>): boolean {
  if (r.statusCode < 200 || r.statusCode >= 300) return false;
  const e = r.errors;
  if (e == null) return true;
  if (Array.isArray(e)) return e.length === 0;
  return typeof e === 'object' && Object.keys(e).length === 0;
}

export function matchesQuery(params: Record<string, string>, q: RawQuery): boolean {
  if (q.has?.some((k) => params[k] === undefined)) return false;
  if (q.lacks?.some((k) => params[k] !== undefined)) return false;
  if (q.where && Object.entries(q.where).some(([k, v]) => params[k] !== v)) return false;
  return true;
}

/** Sobre os registros do InMemoryRawStore (testes unitários e simulações). */
export class InMemoryRawSource implements RawSource {
  constructor(private readonly records: RawRecord[]) {}

  async *latest(query: RawQuery): AsyncIterable<RawEntry> {
    const byHash = new Map<string, RawRecord>();
    for (const r of this.records) {
      if (r.sport !== query.sport || r.endpoint !== query.endpoint || !isSuccess(r)) continue;
      if (!matchesQuery(r.params, query)) continue;
      const prev = byHash.get(r.requestHash);
      if (!prev || prev.fetchedAt <= r.fetchedAt) byHash.set(r.requestHash, r);
    }
    for (const r of byHash.values()) {
      const body = r.body as { response?: unknown; paging?: { current: number; total: number } };
      yield {
        params: r.params,
        response: body.response,
        paging: body.paging ?? null,
        fetchedAt: r.fetchedAt,
      };
    }
  }

  async lastFetched(hashes: string[]): Promise<Map<string, Date>> {
    const wanted = new Set(hashes);
    const out = new Map<string, Date>();
    for (const r of this.records) {
      if (!wanted.has(r.requestHash) || !isSuccess(r)) continue;
      const prev = out.get(r.requestHash);
      if (!prev || prev < r.fetchedAt) out.set(r.requestHash, r.fetchedAt);
    }
    return out;
  }
}

/**
 * raw.api_response, lido em lotes por cursor (respostas de temporada inteira são grandes).
 * Datas saem como epoch em ms: o driver do Drizzle desliga a conversão de timestamptz do postgres.js.
 */
export class PgRawSource implements RawSource {
  constructor(
    private readonly db: Database,
    private readonly batchSize = 50,
  ) {}

  async *latest(query: RawQuery): AsyncIterable<RawEntry> {
    const values: unknown[] = [query.sport, query.endpoint];
    const conditions = [
      `provider = 'api-sports'`,
      `sport = $1`,
      `endpoint = $2`,
      `status_code between 200 and 299`,
      `(errors is null or errors in ('[]'::jsonb, '{}'::jsonb))`,
    ];
    if (query.has?.length) {
      values.push(query.has);
      conditions.push(`params ?& $${values.length}::text[]`);
    }
    if (query.lacks?.length) {
      values.push(query.lacks);
      conditions.push(`not (params ?| $${values.length}::text[])`);
    }
    if (query.where && Object.keys(query.where).length) {
      values.push(JSON.stringify(query.where));
      conditions.push(`params @> $${values.length}::jsonb`);
    }
    const text = `select distinct on (request_hash)
        params, body->'response' as response, body->'paging' as paging,
        (extract(epoch from fetched_at) * 1000)::float8 as fetched_ms
      from raw.api_response
      where ${conditions.join(' and ')}
      order by request_hash, fetched_at desc`;
    const cursor = this.db.$client.unsafe(text, values as never[]).cursor(this.batchSize);
    for await (const rows of cursor) {
      for (const row of rows as unknown as {
        params: Record<string, string>;
        response: unknown;
        paging: { current: number; total: number } | null;
        fetched_ms: number;
      }[]) {
        yield {
          params: row.params,
          response: row.response,
          paging: row.paging,
          fetchedAt: new Date(row.fetched_ms),
        };
      }
    }
  }

  async lastFetched(hashes: string[]): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    const unique = [...new Set(hashes)];
    for (let i = 0; i < unique.length; i += 5000) {
      const chunk = unique.slice(i, i + 5000);
      const rows = (await this.db.$client.unsafe(
        `select request_hash, (extract(epoch from max(fetched_at)) * 1000)::float8 as fetched_ms
           from raw.api_response
          where request_hash = any($1::text[])
            and status_code between 200 and 299
            and (errors is null or errors in ('[]'::jsonb, '{}'::jsonb))
          group by request_hash`,
        [chunk] as never[],
      )) as unknown as { request_hash: string; fetched_ms: number }[];
      for (const r of rows) out.set(r.request_hash, new Date(r.fetched_ms));
    }
    return out;
  }
}
