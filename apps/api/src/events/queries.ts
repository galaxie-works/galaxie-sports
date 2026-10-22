import { and, asc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import * as z from 'zod';
import type { EventStatus } from '@galaxie/contracts';
import { competition, event, type Database } from '@galaxie/db';
import { assertSport } from '../auth/authenticator.js';
import { problems } from '../errors.js';
import { decodeCursor, encodeCursor, UUID_RE } from '../util.js';

export const IN_PLAY: EventStatus[] = ['live', 'break', 'suspended'];

export interface EventFilters {
  start?: Date | null;
  end?: Date | null;
  sport?: string | undefined;
  /** Restrição de esportes do plano do tenant. */
  sports?: string[] | null;
  competition?: string | undefined;
  team?: string | undefined;
  country?: string | undefined;
  status?: EventStatus[] | undefined;
  importanceMin?: number | undefined;
  /** Expressão da relevância no mercado (`relevanceSql`), para `relevance_min` e `order=relevance`. */
  relevance?: SQL | undefined;
  relevanceMin?: number | undefined;
}

export type EventOrder = 'starts_at' | 'importance' | 'relevance';

const StartsCursor = z.object({ s: z.string(), i: z.string().regex(UUID_RE) });
const ImportanceCursor = StartsCursor.extend({ m: z.number().int() });

/**
 * Esportes visíveis para o tenant: com `sport` pedido, valida contra o plano (403) e não restringe mais nada;
 * sem ele, devolve a lista do plano (null = todos). A lista entra no `vary` do cache.
 */
export function sportScope(request: FastifyRequest, requested?: string): string[] | null {
  const tenant = request.tenant;
  if (!tenant) return null;
  if (requested) {
    assertSport(tenant, requested);
    return null;
  }
  return tenant.sports.length ? [...tenant.sports].sort() : null;
}

/** Condição de competição por UUID ou slug. */
export function competitionCond(idOrSlug: string): SQL {
  return UUID_RE.test(idOrSlug)
    ? eq(event.competitionId, idOrSlug)
    : sql`${event.competitionId} in (select c.id from ${competition} c where c.slug = ${idOrSlug})`;
}

export function filterConds(f: EventFilters): SQL[] {
  const conds: SQL[] = [];
  if (f.start) conds.push(gte(event.startsAt, f.start));
  if (f.end) conds.push(lt(event.startsAt, f.end));
  if (f.sport) conds.push(eq(event.sport, f.sport));
  if (f.sports?.length) conds.push(inArray(event.sport, f.sports));
  if (f.competition) conds.push(competitionCond(f.competition));
  if (f.team)
    conds.push(
      sql`exists (select 1 from core.event_participant ep where ep.event_id = ${event.id} and ep.participant_id = ${f.team}::uuid)`,
    );
  if (f.country)
    conds.push(
      sql`(exists (select 1 from core.competition c where c.id = ${event.competitionId} and c.country_code = ${f.country})
           or exists (select 1 from core.event_participant ep join core.participant p on p.id = ep.participant_id
                       where ep.event_id = ${event.id} and p.country_code = ${f.country}))`,
    );
  if (f.status?.length) conds.push(inArray(event.status, f.status));
  if (f.importanceMin !== undefined) conds.push(gte(event.importance, f.importanceMin));
  if (f.relevanceMin !== undefined) {
    if (!f.relevance) throw marketRequired('relevance_min');
    conds.push(sql`${f.relevance} >= ${f.relevanceMin}`);
  }
  return conds;
}

function marketRequired(param: string) {
  return problems.invalidParams([
    { path: param, message: 'exige `market` (ou um único mercado no plano do tenant)' },
  ]);
}

/**
 * Página de IDs de eventos por cursor (`starts_at` crescente; `importance` ou `relevance` decrescentes,
 * depois horário). `relevance` usa a expressão do mercado em `filters.relevance`.
 */
export async function pageEventIds(
  db: Database,
  filters: EventFilters,
  options: { order: EventOrder; limit: number; cursor?: string | undefined },
): Promise<{ ids: string[]; nextCursor: string | null }> {
  const conds = filterConds(filters);
  if (options.order === 'relevance' && !filters.relevance) throw marketRequired('order');
  // métrica decrescente da ordenação (importância global ou relevância no mercado)
  const metric: SQL | null =
    options.order === 'importance'
      ? sql`${event.importance}`
      : options.order === 'relevance'
        ? filters.relevance!
        : null;
  if (options.cursor) {
    if (metric) {
      const c = decodeCursor(ImportanceCursor, options.cursor);
      conds.push(
        sql`(-(${metric}), ${event.startsAt}, ${event.id}) > (${-c.m}, ${c.s}::timestamptz, ${c.i}::uuid)`,
      );
    } else {
      const c = decodeCursor(StartsCursor, options.cursor);
      conds.push(sql`(${event.startsAt}, ${event.id}) > (${c.s}::timestamptz, ${c.i}::uuid)`);
    }
  }
  const order = metric
    ? [sql`${metric} desc`, asc(event.startsAt), asc(event.id)]
    : [asc(event.startsAt), asc(event.id)];
  const rows = await db
    .select({
      id: event.id,
      startsAt: event.startsAt,
      metric: metric ? sql<number>`(${metric})::int` : sql<number>`0`,
    })
    .from(event)
    .where(and(...conds))
    .orderBy(...order)
    .limit(options.limit + 1);
  const pageRows = rows.slice(0, options.limit);
  const last = pageRows.at(-1);
  const nextCursor =
    rows.length > options.limit && last
      ? encodeCursor(
          metric
            ? { m: Number(last.metric), s: last.startsAt.toISOString(), i: last.id }
            : { s: last.startsAt.toISOString(), i: last.id },
        )
      : null;
  return { ids: pageRows.map((r) => r.id), nextCursor };
}

/** Evento mínimo (existência e esporte) — 404 se não existir. */
export async function eventHead(db: Database, id: string) {
  const [row] = await db
    .select({
      id: event.id,
      sport: event.sport,
      status: event.status,
      startsAt: event.startsAt,
      endsAtExpected: event.endsAtExpected,
      updatedAt: event.updatedAt,
    })
    .from(event)
    .where(eq(event.id, id))
    .limit(1);
  if (!row) throw problems.notFound('Evento');
  return row;
}

/** Valida a janela from/to. */
export function assertWindow(start: Date | null, end: Date | null): void {
  if (start && end && start >= end)
    throw problems.invalidParams([{ path: 'to', message: '`to` deve ser posterior a `from`' }]);
}
