import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { apiResponse, type Database, type RawRetentionClass } from '@galaxie/db';

export interface RawRecord {
  provider: string;
  sport: string;
  apiVersion: string;
  endpoint: string;
  params: Record<string, string>;
  requestHash: string;
  page: number;
  statusCode: number;
  results: number | null;
  errors: unknown;
  body: unknown;
  bodyHash: string;
  quotaRemaining: number | null;
  jobId: string | null;
  fetchedAt: Date;
  /** `live` = o ao vivo buscou (prioridade LIVE) e fica 30 dias; padrão `keep` (para sempre). */
  retention?: RawRetentionClass;
}

/** Registro guardado: a primeira chegada do corpo e quantas vezes ele voltou igual. */
export interface StoredRawRecord extends RawRecord {
  /** Última vez que o mesmo corpo chegou (null = só em `fetchedAt`). */
  lastSeenAt: Date | null;
  seenCount: number;
}

/** `inserted` = linha nova; `seen` = mesmo corpo da última resposta da requisição, só o "visto em" andou. */
export type RawSaveOutcome = 'inserted' | 'seen';

export interface RawHit {
  body: unknown;
  /** Última vez que o fornecedor entregou este corpo (`coalesce(last_seen_at, fetched_at)`). */
  fetchedAt: Date;
  quotaRemaining: number | null;
}

/**
 * De onde veio a requisição. O request hash já identifica tudo, mas a busca precisa dos três campos para
 * usar o índice raw.api_response_lookup_idx (provider, sport, endpoint, request_hash, fetched_at): só pelo
 * hash, uma falta com TTL infinito varre a maior tabela do banco.
 */
export interface RawScope {
  provider: string;
  sport: string;
  endpoint: string;
}

/**
 * Armazena toda resposta bruta e serve respostas frescas (HTTP 2xx e sem erro no envelope) para evitar chamadas
 * repetidas. Um corpo igual ao da última resposta da mesma requisição (mesmo status e mesmo sha256) não vira
 * linha nova: a última linha ganha `last_seen_at` e `seen_count`, e o frescor conta por esse "visto em".
 */
export interface RawStore {
  findFresh(requestHash: string, maxAgeMs: number, now: Date, scope: RawScope): Promise<RawHit | undefined>;
  save(record: RawRecord): Promise<RawSaveOutcome>;
}

function isSuccess(errors: unknown): boolean {
  if (errors == null) return true;
  if (Array.isArray(errors)) return errors.length === 0;
  return typeof errors === 'object' && Object.keys(errors).length === 0;
}

const seenAt = (r: StoredRawRecord): Date => r.lastSeenAt ?? r.fetchedAt;

export class InMemoryRawStore implements RawStore {
  readonly records: StoredRawRecord[] = [];

  async findFresh(requestHash: string, maxAgeMs: number, now: Date): Promise<RawHit | undefined> {
    const minTime = Number.isFinite(maxAgeMs) ? now.getTime() - maxAgeMs : Number.NEGATIVE_INFINITY;
    // a mais recente de sucesso: uma anterior foi vista pela última vez antes de a seguinte chegar
    const hit = [...this.records]
      .reverse()
      .find(
        (r) =>
          r.requestHash === requestHash && r.statusCode >= 200 && r.statusCode < 300 && isSuccess(r.errors),
      );
    if (!hit || seenAt(hit).getTime() < minTime) return undefined;
    return { body: hit.body, fetchedAt: seenAt(hit), quotaRemaining: hit.quotaRemaining };
  }

  async save(record: RawRecord): Promise<RawSaveOutcome> {
    const last = [...this.records].reverse().find((r) => r.requestHash === record.requestHash);
    if (last && last.bodyHash === record.bodyHash && last.statusCode === record.statusCode) {
      if (record.fetchedAt > seenAt(last)) last.lastSeenAt = record.fetchedAt;
      last.seenCount += 1;
      if (record.quotaRemaining != null) last.quotaRemaining = record.quotaRemaining;
      return 'seen';
    }
    this.records.push({ ...record, lastSeenAt: null, seenCount: 1 });
    return 'inserted';
  }
}

export class PgRawStore implements RawStore {
  constructor(private readonly db: Database) {}

  async findFresh(
    requestHash: string,
    maxAgeMs: number,
    now: Date,
    scope: RawScope,
  ): Promise<RawHit | undefined> {
    const success = sql`(${apiResponse.errors} is null or ${apiResponse.errors} in ('[]'::jsonb, '{}'::jsonb))`;
    const [row] = await this.db
      .select({
        body: apiResponse.body,
        seenMs: sql<number>`(extract(epoch from coalesce(${apiResponse.lastSeenAt}, ${apiResponse.fetchedAt})) * 1000)::float8`,
        quotaRemaining: apiResponse.quotaRemaining,
      })
      .from(apiResponse)
      .where(
        and(
          eq(apiResponse.provider, scope.provider),
          eq(apiResponse.sport, scope.sport),
          eq(apiResponse.endpoint, scope.endpoint),
          eq(apiResponse.requestHash, requestHash),
          success,
          gte(apiResponse.statusCode, 200),
          lt(apiResponse.statusCode, 300),
        ),
      )
      .orderBy(desc(apiResponse.fetchedAt))
      .limit(1);
    // só a mais recente de sucesso conta (ver InMemoryRawStore.findFresh)
    if (!row) return undefined;
    const fetchedAt = new Date(Number(row.seenMs));
    if (Number.isFinite(maxAgeMs) && fetchedAt.getTime() < now.getTime() - maxAgeMs) return undefined;
    return { body: row.body, fetchedAt, quotaRemaining: row.quotaRemaining };
  }

  /**
   * Um comando só: compara com a última resposta da requisição (índice api_response_lookup_idx) e, se o corpo
   * e o status são os mesmos, só estende o "visto em"; senão grava a linha nova.
   */
  async save(record: RawRecord): Promise<RawSaveOutcome> {
    const fetchedAt = record.fetchedAt.toISOString();
    const errors = record.errors == null ? null : JSON.stringify(record.errors);
    const rows = await this.db.execute<{ outcome: RawSaveOutcome }>(sql`
      with last as (
        select id, body_hash, status_code from raw.api_response
         where provider = ${record.provider} and sport = ${record.sport}
           and endpoint = ${record.endpoint} and request_hash = ${record.requestHash}
         order by fetched_at desc, id desc
         limit 1
      ), seen as (
        update raw.api_response r
           set last_seen_at = greatest(coalesce(r.last_seen_at, r.fetched_at), ${fetchedAt}::timestamptz),
               seen_count = r.seen_count + 1,
               quota_remaining = coalesce(${record.quotaRemaining}::int, r.quota_remaining)
          from last
         where r.id = last.id and last.body_hash = ${record.bodyHash}
           and last.status_code = ${record.statusCode}::int
        returning r.id
      ), inserted as (
        insert into raw.api_response (provider, sport, api_version, endpoint, params, request_hash, page,
          status_code, results, errors, body, body_hash, quota_remaining, job_id, fetched_at, retention)
        select ${record.provider}, ${record.sport}, ${record.apiVersion}, ${record.endpoint},
               ${JSON.stringify(record.params)}::jsonb, ${record.requestHash}, ${record.page}::int,
               ${record.statusCode}::int, ${record.results}::int, ${errors}::jsonb,
               ${JSON.stringify(record.body)}::jsonb, ${record.bodyHash}, ${record.quotaRemaining}::int,
               ${record.jobId}, ${fetchedAt}::timestamptz, ${record.retention ?? 'keep'}
         where not exists (select 1 from seen)
        returning id
      )
      select case when exists (select 1 from seen) then 'seen' else 'inserted' end as outcome`);
    return rows[0]?.outcome ?? 'inserted';
  }
}
