import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { apiResponse, type Database } from '@galaxie/db';

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
}

export interface RawHit {
  body: unknown;
  fetchedAt: Date;
  quotaRemaining: number | null;
}

/** Armazena toda resposta bruta e serve respostas frescas (HTTP 2xx e sem erro no envelope) para evitar chamadas repetidas. */
export interface RawStore {
  findFresh(requestHash: string, maxAgeMs: number, now: Date): Promise<RawHit | undefined>;
  save(record: RawRecord): Promise<void>;
}

function isSuccess(errors: unknown): boolean {
  if (errors == null) return true;
  if (Array.isArray(errors)) return errors.length === 0;
  return typeof errors === 'object' && Object.keys(errors).length === 0;
}

export class InMemoryRawStore implements RawStore {
  readonly records: RawRecord[] = [];

  async findFresh(requestHash: string, maxAgeMs: number, now: Date): Promise<RawHit | undefined> {
    const minTime = Number.isFinite(maxAgeMs) ? now.getTime() - maxAgeMs : Number.NEGATIVE_INFINITY;
    const hit = [...this.records]
      .reverse()
      .find(
        (r) =>
          r.requestHash === requestHash &&
          r.statusCode >= 200 &&
          r.statusCode < 300 &&
          isSuccess(r.errors) &&
          r.fetchedAt.getTime() >= minTime,
      );
    return hit ? { body: hit.body, fetchedAt: hit.fetchedAt, quotaRemaining: hit.quotaRemaining } : undefined;
  }

  async save(record: RawRecord): Promise<void> {
    this.records.push(record);
  }
}

export class PgRawStore implements RawStore {
  constructor(private readonly db: Database) {}

  async findFresh(requestHash: string, maxAgeMs: number, now: Date): Promise<RawHit | undefined> {
    const success = sql`(${apiResponse.errors} is null or ${apiResponse.errors} in ('[]'::jsonb, '{}'::jsonb))`;
    const conditions = [
      eq(apiResponse.requestHash, requestHash),
      success,
      gte(apiResponse.statusCode, 200),
      lt(apiResponse.statusCode, 300),
    ];
    if (Number.isFinite(maxAgeMs))
      conditions.push(gte(apiResponse.fetchedAt, new Date(now.getTime() - maxAgeMs)));
    const [row] = await this.db
      .select({
        body: apiResponse.body,
        fetchedAt: apiResponse.fetchedAt,
        quotaRemaining: apiResponse.quotaRemaining,
      })
      .from(apiResponse)
      .where(and(...conditions))
      .orderBy(desc(apiResponse.fetchedAt))
      .limit(1);
    return row;
  }

  async save(record: RawRecord): Promise<void> {
    await this.db.insert(apiResponse).values({
      provider: record.provider,
      sport: record.sport,
      apiVersion: record.apiVersion,
      endpoint: record.endpoint,
      params: record.params,
      requestHash: record.requestHash,
      page: record.page,
      statusCode: record.statusCode,
      results: record.results,
      errors: record.errors ?? null,
      body: record.body,
      bodyHash: record.bodyHash,
      quotaRemaining: record.quotaRemaining,
      jobId: record.jobId,
      fetchedAt: record.fetchedAt,
    });
  }
}
