import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { MirrorEnvelope } from '@galaxie/contracts';
import { event, footballFixture, type Database } from '@galaxie/db';
import { formatInstant } from '../i18n.js';
import { addDays, dayRange, zonedMidnight } from '../time.js';

/**
 * Remontagem de respostas do espelho a partir do `core` (`x-galaxie-source: rebuilt`): partidas de futebol
 * guardadas em `core.football_fixture` (resumo do fornecedor + detalhe), filtradas como a api-sports faria.
 * Só combinações de parâmetros que o core responde com segurança; o resto continua `miss`.
 */

const FIXTURE_KEYS = new Set([
  'id',
  'ids',
  'live',
  'date',
  'league',
  'season',
  'team',
  'round',
  'status',
  'from',
  'to',
  'timezone',
]);
const H2H_KEYS = new Set(['h2h', 'last', 'league', 'season', 'status', 'from', 'to', 'date', 'timezone']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INT_RE = /^\d{1,9}$/;
const DETAIL_PARTS = ['events', 'lineups', 'statistics', 'players'] as const;
const SUMMARY_KEYS = ['fixture', 'league', 'teams', 'goals', 'score'] as const;

export interface RebuiltResponse {
  body: MirrorEnvelope;
  /** Última observação válida entre as partidas remontadas (x-galaxie-fetched-at). */
  latestAt: Date | null;
}

/** `summary->'a'->'b'->>'c'` (caminho fixo, sem entrada do usuário). */
const asText = (path: string[]) => {
  const head = path
    .slice(0, -1)
    .map((p) => `->'${p}'`)
    .join('');
  return sql.raw(`("football_fixture"."summary"${head}->>'${path.at(-1)}')`);
};

function validTz(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Partidas que casam com a requisição; `null` quando a combinação não é remontável. */
function plan(
  endpoint: string,
  params: Record<string, string>,
): { conds: SQL[]; detail: 'full' | 'events' | null; last: number | null } | null {
  const keys = Object.keys(params);
  const tz = validTz(params.timezone);
  const conds: SQL[] = [];
  let detail: 'full' | 'events' | null = null;
  let last: number | null = null;

  const dateConds = () => {
    if (params.date) {
      if (!DATE_RE.test(params.date)) return false;
      const r = dayRange(params.date, tz);
      conds.push(gte(event.startsAt, r.start), lt(event.startsAt, r.end));
    }
    if (params.from || params.to) {
      if (!params.from || !params.to || !DATE_RE.test(params.from) || !DATE_RE.test(params.to)) return false;
      conds.push(
        gte(event.startsAt, zonedMidnight(params.from, tz)),
        lt(event.startsAt, zonedMidnight(addDays(params.to, 1), tz)),
      );
    }
    return true;
  };
  const common = () => {
    if (params.league) {
      if (!INT_RE.test(params.league)) return false;
      conds.push(sql`${asText(['league', 'id'])} = ${params.league}`);
    }
    if (params.season) {
      if (!INT_RE.test(params.season)) return false;
      conds.push(sql`${asText(['league', 'season'])} = ${params.season}`);
    }
    if (params.status) {
      const codes = params.status.split('-').filter(Boolean);
      if (!codes.length) return false;
      conds.push(
        sql`${asText(['fixture', 'status', 'short'])} in (${sql.join(
          codes.map((c) => sql`${c}`),
          sql`, `,
        )})`,
      );
    }
    return dateConds();
  };

  if (endpoint === '/fixtures') {
    if (keys.some((k) => !FIXTURE_KEYS.has(k))) return null;
    const own = keys.filter((k) => k !== 'timezone');
    if (params.id !== undefined) {
      if (own.length !== 1 || !INT_RE.test(params.id)) return null;
      conds.push(eq(footballFixture.providerFixtureId, Number(params.id)));
      return { conds, detail: 'full', last };
    }
    if (params.ids !== undefined) {
      const ids = params.ids.split('-');
      if (own.length !== 1 || !ids.length || ids.length > 20 || !ids.every((i) => INT_RE.test(i)))
        return null;
      conds.push(inArray(footballFixture.providerFixtureId, ids.map(Number)));
      return { conds, detail: 'full', last };
    }
    if (params.live !== undefined) {
      if (own.length !== 1) return null;
      conds.push(inArray(event.status, ['live', 'break', 'suspended']));
      if (params.live !== 'all') {
        const leagues = params.live.split('-');
        if (!leagues.every((l) => INT_RE.test(l))) return null;
        conds.push(
          sql`${asText(['league', 'id'])} in (${sql.join(
            leagues.map((l) => sql`${l}`),
            sql`, `,
          )})`,
        );
      }
      detail = 'events';
      return { conds, detail, last };
    }
    // agenda: dia, ou temporada de uma liga/time
    const scoped = !!params.date || (!!params.season && (!!params.league || !!params.team));
    if (!scoped) return null;
    if (params.team) {
      if (!INT_RE.test(params.team)) return null;
      conds.push(
        or(
          sql`${asText(['teams', 'home', 'id'])} = ${params.team}`,
          sql`${asText(['teams', 'away', 'id'])} = ${params.team}`,
        )!,
      );
    }
    if (params.round) conds.push(sql`${asText(['league', 'round'])} = ${params.round}`);
    if (!common()) return null;
    return { conds, detail, last };
  }

  if (endpoint === '/fixtures/headtohead') {
    if (keys.some((k) => !H2H_KEYS.has(k))) return null;
    const m = /^(\d{1,9})-(\d{1,9})$/.exec(params.h2h ?? '');
    if (!m || m[1] === m[2]) return null;
    const [a, b] = [m[1]!, m[2]!];
    conds.push(
      or(
        and(sql`${asText(['teams', 'home', 'id'])} = ${a}`, sql`${asText(['teams', 'away', 'id'])} = ${b}`),
        and(sql`${asText(['teams', 'home', 'id'])} = ${b}`, sql`${asText(['teams', 'away', 'id'])} = ${a}`),
      )!,
    );
    if (params.last !== undefined) {
      if (!INT_RE.test(params.last) || Number(params.last) < 1) return null;
      last = Number(params.last);
      conds.push(sql`${asText(['fixture', 'status', 'short'])} in ('FT', 'AET', 'PEN', 'AWD', 'WO')`);
    }
    if (!common()) return null;
    return { conds, detail, last };
  }
  return null;
}

/** Converte `fixture.date` para o fuso pedido (como a api-sports faz com `timezone`). */
function withTimezone(summary: Record<string, unknown>, tz: string): Record<string, unknown> {
  if (tz === 'UTC') return summary;
  const fixture = summary.fixture as { timestamp?: number; date?: string } | undefined;
  if (!fixture?.timestamp) return summary;
  return {
    ...summary,
    fixture: { ...fixture, timezone: tz, date: formatInstant(new Date(fixture.timestamp * 1000), tz) },
  };
}

export async function rebuildFromCore(
  db: Database,
  sport: string,
  endpoint: string,
  params: Record<string, string>,
): Promise<RebuiltResponse | null> {
  if (sport !== 'football') return null;
  const p = plan(endpoint, params);
  if (!p) return null;
  const rows = await db
    .select({
      summary: footballFixture.summary,
      detail: footballFixture.detail,
      lastValidAt: event.lastValidAt,
      startsAt: event.startsAt,
    })
    .from(footballFixture)
    .innerJoin(event, eq(event.id, footballFixture.eventId))
    .where(and(...p.conds))
    .orderBy(p.last ? desc(event.startsAt) : asc(event.startsAt), asc(footballFixture.providerFixtureId))
    .limit(p.last ?? 2000);
  if (!rows.length) return null;
  if (p.last) rows.reverse();
  const tz = validTz(params.timezone);
  let latestAt: Date | null = null;
  const response = rows.map((r) => {
    if (r.lastValidAt && (!latestAt || r.lastValidAt > latestAt)) latestAt = r.lastValidAt;
    const summary = withTimezone(r.summary as Record<string, unknown>, tz);
    // ordem de chaves da api-sports (o JSONB não preserva a ordem)
    const item: Record<string, unknown> = {};
    for (const k of SUMMARY_KEYS) if (k in summary) item[k] = summary[k];
    for (const [k, v] of Object.entries(summary)) if (!(k in item)) item[k] = v;
    const detail = (r.detail ?? {}) as Record<string, unknown>;
    if (p.detail === 'full') {
      for (const part of DETAIL_PARTS) item[part] = Array.isArray(detail[part]) ? detail[part] : [];
    } else if (p.detail === 'events') {
      item.events = Array.isArray(detail.events) ? detail.events : [];
    }
    return item;
  });
  return {
    body: {
      get: endpoint.replace(/^\//, ''),
      parameters: Object.keys(params).length ? params : [],
      errors: [],
      results: response.length,
      paging: { current: 1, total: 1 },
      response,
    },
    latestAt,
  };
}
