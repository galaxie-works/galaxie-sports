import { and, eq, inArray, sql } from 'drizzle-orm';
import { syncCursor, type Database } from '@galaxie/db';

/** Identifica um item retomável em ops.sync_cursor: (esporte, endpoint, chave). */
export interface CursorRef {
  sport: string;
  endpoint: string;
  /** Parâmetros normalizados em forma de query string (ex.: "league=71&season=2024"). */
  key: string;
}

export interface CursorState {
  completedAt: Date | null;
  cursor: Record<string, unknown> | null;
}

/** Tentativas com erro do fornecedor depois das quais o item deixa de ser repetido (salvo `--forcar`). */
export const MAX_ATTEMPTS = 3;

export function cursorId(ref: CursorRef): string {
  return `${ref.sport}|${ref.endpoint}|${ref.key}`;
}

export function attemptsOf(state: CursorState | undefined): number {
  const n = state?.cursor?.attempts;
  return typeof n === 'number' ? n : 0;
}

/** Marca d'água dos jobs: o que já foi concluído não é buscado de novo na próxima execução. */
export interface CursorStore {
  load(refs: CursorRef[]): Promise<Map<string, CursorState>>;
  /** Todos os cursores de um endpoint (rodízio de entidades). */
  list(sport: string, endpoint: string): Promise<Map<string, CursorState>>;
  complete(refs: CursorRef[], data: Record<string, unknown>, at: Date): Promise<void>;
  /** Registra erro do fornecedor sem concluir (incrementa `attempts`). */
  fail(refs: CursorRef[], error: string, at: Date): Promise<void>;
}

export class InMemoryCursorStore implements CursorStore {
  readonly rows = new Map<string, CursorState & { ref: CursorRef }>();

  async load(refs: CursorRef[]): Promise<Map<string, CursorState>> {
    const out = new Map<string, CursorState>();
    for (const r of refs) {
      const row = this.rows.get(cursorId(r));
      if (row) out.set(cursorId(r), { completedAt: row.completedAt, cursor: row.cursor });
    }
    return out;
  }

  async list(sport: string, endpoint: string): Promise<Map<string, CursorState>> {
    const out = new Map<string, CursorState>();
    for (const row of this.rows.values()) {
      if (row.ref.sport === sport && row.ref.endpoint === endpoint) {
        out.set(row.ref.key, { completedAt: row.completedAt, cursor: row.cursor });
      }
    }
    return out;
  }

  async complete(refs: CursorRef[], data: Record<string, unknown>, at: Date): Promise<void> {
    for (const ref of refs) this.rows.set(cursorId(ref), { ref, completedAt: at, cursor: { ...data } });
  }

  async fail(refs: CursorRef[], error: string, at: Date): Promise<void> {
    for (const ref of refs) {
      const prev = this.rows.get(cursorId(ref));
      this.rows.set(cursorId(ref), {
        ref,
        completedAt: prev?.completedAt ?? null,
        cursor: {
          ...(prev?.cursor ?? {}),
          error,
          attempts: attemptsOf(prev) + 1,
          lastAttemptAt: at.toISOString(),
        },
      });
    }
  }
}

const PROVIDER = 'api-sports';

function groupByEndpoint(
  refs: CursorRef[],
): Map<string, { sport: string; endpoint: string; keys: string[] }> {
  const groups = new Map<string, { sport: string; endpoint: string; keys: string[] }>();
  for (const r of refs) {
    const g = groups.get(`${r.sport}|${r.endpoint}`) ?? { sport: r.sport, endpoint: r.endpoint, keys: [] };
    g.keys.push(r.key);
    groups.set(`${r.sport}|${r.endpoint}`, g);
  }
  return groups;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** ops.sync_cursor. */
export class PgCursorStore implements CursorStore {
  constructor(private readonly db: Database) {}

  async load(refs: CursorRef[]): Promise<Map<string, CursorState>> {
    const out = new Map<string, CursorState>();
    for (const g of groupByEndpoint(refs).values()) {
      for (const keys of chunks([...new Set(g.keys)], 5000)) {
        const rows = await this.db
          .select({ key: syncCursor.key, cursor: syncCursor.cursor, completedAt: syncCursor.completedAt })
          .from(syncCursor)
          .where(
            and(
              eq(syncCursor.provider, PROVIDER),
              eq(syncCursor.sport, g.sport),
              eq(syncCursor.endpoint, g.endpoint),
              inArray(syncCursor.key, keys),
            ),
          );
        for (const row of rows) {
          out.set(cursorId({ sport: g.sport, endpoint: g.endpoint, key: row.key }), {
            completedAt: row.completedAt,
            cursor: (row.cursor as Record<string, unknown> | null) ?? null,
          });
        }
      }
    }
    return out;
  }

  async list(sport: string, endpoint: string): Promise<Map<string, CursorState>> {
    const rows = await this.db
      .select({ key: syncCursor.key, cursor: syncCursor.cursor, completedAt: syncCursor.completedAt })
      .from(syncCursor)
      .where(
        and(
          eq(syncCursor.provider, PROVIDER),
          eq(syncCursor.sport, sport),
          eq(syncCursor.endpoint, endpoint),
        ),
      );
    return new Map(
      rows.map((r) => [
        r.key,
        { completedAt: r.completedAt, cursor: (r.cursor as Record<string, unknown> | null) ?? null },
      ]),
    );
  }

  async complete(refs: CursorRef[], data: Record<string, unknown>, at: Date): Promise<void> {
    if (!refs.length) return;
    for (const chunk of chunks(refs, 1000)) {
      await this.db
        .insert(syncCursor)
        .values(
          chunk.map((r) => ({
            provider: PROVIDER,
            sport: r.sport,
            endpoint: r.endpoint,
            key: r.key,
            cursor: data,
            completedAt: at,
            updatedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
          set: {
            cursor: sql`excluded.cursor`,
            completedAt: sql`excluded.completed_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  }

  async fail(refs: CursorRef[], error: string, at: Date): Promise<void> {
    if (!refs.length) return;
    const first = { error, attempts: 1, lastAttemptAt: at.toISOString() };
    for (const chunk of chunks(refs, 1000)) {
      await this.db
        .insert(syncCursor)
        .values(
          chunk.map((r) => ({
            provider: PROVIDER,
            sport: r.sport,
            endpoint: r.endpoint,
            key: r.key,
            cursor: first,
            completedAt: null,
            updatedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
          set: {
            cursor: sql`coalesce(${syncCursor.cursor}, '{}'::jsonb) || jsonb_build_object(
              'error', ${error}::text,
              'attempts', coalesce((${syncCursor.cursor}->>'attempts')::int, 0) + 1,
              'lastAttemptAt', ${at.toISOString()}::text)`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  }
}
