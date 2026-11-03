import type { Database } from '@galaxie/db';
import { sql } from 'drizzle-orm';
import { Gauge, type Registry } from 'prom-client';

/**
 * Ritmo do ao vivo (issue #538): intervalo entre ticks, idade do último tick, janela aberta e quem é a líder.
 *
 * O `live-run` é um processo filho do scheduler, sem servidor próprio, e com líder e reserva (#536) o tick de um
 * minuto pode ser da cópia de outro contêiner. Por isso o runner grava o ritmo em `ops.sync_cursor` (endpoint
 * `live:scheduler`, chave `tick`, uma linha por esporte) e o `/metrics` do scheduler lê daqui a cada coleta, como as
 * demais métricas do ao vivo (`galaxie_live_scheduler_*`): vale com qualquer número de processos e atravessa a troca
 * de versão, que é o que a métrica precisa provar. As janelas do dia vêm do estado do plano (chave `state`).
 *
 * Os nomes não levam o prefixo `galaxie_` (como o `build_info`): são o contrato do alerta `LiveTickGap` e do SLO
 * `ao-vivo` em infra/observability/prometheus.
 */

export const LIVE_STATE_CURSOR_ENDPOINT = 'live:scheduler';
export const LIVE_TICK_CURSOR_KEY = 'tick';
/** Prefixo do nome da sessão da trava `live:leader` em pg_stat_activity (`<prefixo><instância>`). */
export const LIVE_LEADER_SESSION_PREFIX = 'galaxie-live-leader:';
/** Quanto tempo os intervalos recentes ficam no registro (e entram no maior intervalo da métrica). */
export const LIVE_TICK_RECENT_MS = 5 * 60_000;

/** O que o runner do ao vivo grava a cada tick (e quando o ritmo muda): a linha `tick` do `ops.sync_cursor`. */
export interface LiveTickCursor {
  /** Cópia (hostname) que gravou por último. */
  instance: string;
  updatedAt: string;
  /** Hora do último tick de qualquer cópia: o intervalo atravessa a troca de líder ou de versão. */
  lastTickAt: string | null;
  /** Intervalo (s) entre os dois últimos ticks; `null` depois de uma pausa de propósito ou sem tick anterior. */
  lastIntervalSeconds: number | null;
  /** Intervalos recentes (só dentro de `LIVE_TICK_RECENT_MS`). */
  recent: { at: string; seconds: number }[];
  /** Intervalo que o plano pede entre ticks agora (s). */
  plannedIntervalSeconds: number | null;
  /**
   * Até quando o runner não espera tick de propósito (meio-tempo, orçamento do dia, espera depois de erro da fonte,
   * entre janelas); `null` = deveria estar ticando no ritmo do plano.
   */
  pausedUntil: string | null;
}

export interface LiveTickRow {
  sport: string;
  tick: LiveTickCursor | null;
  /** Janelas unidas do plano do dia (estado do ao vivo). */
  segments: { start: string; end: string }[] | null;
}

export interface LiveLeaderRow {
  instance: string;
  leader: boolean;
}

export interface LiveTickSample {
  sport: string;
  /** Idade do último tick (s); `null` sem tick registrado. */
  lastTickAgeSeconds: number | null;
  intervalSeconds: number | null;
  /** Maior intervalo entre ticks nos últimos 5 min; `null` sem intervalo medido. */
  intervalMaxSeconds: number | null;
  /** 0 = desconhecido: o alerta cai no piso de 60 s. */
  plannedIntervalSeconds: number;
  windowOpen: boolean;
  paused: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;

/** Lê o JSON do cursor sem confiar nele (outra versão do runner pode ter gravado). */
export function parseLiveTick(cursor: unknown): LiveTickCursor | null {
  if (!isObject(cursor)) return null;
  const recent = Array.isArray(cursor.recent)
    ? cursor.recent.flatMap((r: unknown) => {
        if (!isObject(r)) return [];
        const at = iso(r.at);
        const seconds = finite(r.seconds);
        return at !== null && seconds !== null ? [{ at, seconds }] : [];
      })
    : [];
  return {
    instance: typeof cursor.instance === 'string' ? cursor.instance : '',
    updatedAt: iso(cursor.updatedAt) ?? new Date(0).toISOString(),
    lastTickAt: iso(cursor.lastTickAt),
    lastIntervalSeconds: finite(cursor.lastIntervalSeconds),
    recent,
    plannedIntervalSeconds: finite(cursor.plannedIntervalSeconds),
    pausedUntil: iso(cursor.pausedUntil),
  };
}

function parseSegments(cursor: unknown): { start: string; end: string }[] | null {
  if (!isObject(cursor) || !Array.isArray(cursor.segments)) return null;
  return cursor.segments.flatMap((s: unknown) => {
    if (!isObject(s)) return [];
    const start = iso(s.start);
    const end = iso(s.end);
    return start !== null && end !== null ? [{ start, end }] : [];
  });
}

/** Estado do plano e ritmo gravado, por esporte (somente leitura). */
export async function liveTickRows(db: Database): Promise<LiveTickRow[]> {
  const rows = await db.execute<{ sport: string; key: string; cursor: unknown }>(sql`
    select sport, key, cursor
    from ops.sync_cursor
    where endpoint = ${LIVE_STATE_CURSOR_ENDPOINT} and key in ('state', ${LIVE_TICK_CURSOR_KEY})
  `);
  const bySport = new Map<string, LiveTickRow>();
  for (const r of rows) {
    const row = bySport.get(r.sport) ?? { sport: r.sport, tick: null, segments: null };
    if (r.key === LIVE_TICK_CURSOR_KEY) row.tick = parseLiveTick(r.cursor);
    else row.segments = parseSegments(r.cursor);
    bySport.set(r.sport, row);
  }
  return [...bySport.values()];
}

/**
 * As cópias que disputam a liderança do `live-run` e quem tem a trava `live:leader` (a consulta do README do
 * ingestor). Vazio sem `LIVE_LEADER=on`: ninguém disputa.
 */
export async function liveLeaders(db: Database): Promise<LiveLeaderRow[]> {
  const rows = await db.execute<{ application_name: string; leader: boolean }>(sql`
    select a.application_name, coalesce(bool_or(l.pid is not null), false) as leader
    from pg_stat_activity a
    left join pg_locks l on l.pid = a.pid and l.locktype = 'advisory' and l.granted
    where a.application_name like ${`${LIVE_LEADER_SESSION_PREFIX}%`}
    group by a.application_name
  `);
  return rows.map((r) => ({
    instance: r.application_name.slice(LIVE_LEADER_SESSION_PREFIX.length),
    leader: r.leader,
  }));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** As amostras de cada esporte em `now` (a idade e a janela dependem do instante da coleta, não da gravação). */
export function liveTickSamples(rows: readonly LiveTickRow[], now: Date): LiveTickSample[] {
  const t = now.getTime();
  return rows.map(({ sport, tick, segments }) => {
    const lastTickMs = tick?.lastTickAt ? Date.parse(tick.lastTickAt) : null;
    const recent = (tick?.recent ?? []).filter((r) => t - Date.parse(r.at) <= LIVE_TICK_RECENT_MS);
    return {
      sport,
      lastTickAgeSeconds: lastTickMs === null ? null : Math.max(0, round1((t - lastTickMs) / 1000)),
      intervalSeconds: tick?.lastIntervalSeconds ?? null,
      intervalMaxSeconds: recent.length ? Math.max(...recent.map((r) => r.seconds)) : null,
      plannedIntervalSeconds: tick?.plannedIntervalSeconds ?? 0,
      windowOpen: (segments ?? []).some((s) => Date.parse(s.start) <= t && t < Date.parse(s.end)),
      paused: tick?.pausedUntil ? Date.parse(tick.pausedUntil) > t : false,
    };
  });
}

export interface LiveTickMetricsOptions {
  now?: (() => Date) | undefined;
  /** Cache das consultas entre coletas (ms). Curto: a idade do tick não pode envelhecer na cópia. */
  cacheMs?: number | undefined;
  onCollectorError?: ((collector: string, err: unknown) => void) | undefined;
}

/**
 * Registra no `registry` as métricas do ritmo do ao vivo, lidas do Postgres a cada coleta:
 *
 * - `live_last_tick_age_seconds{sport}`: idade do último tick de qualquer cópia (s).
 * - `live_tick_interval_seconds{sport}`: último intervalo entre ticks (s), atravessando a troca de líder ou de versão.
 * - `live_tick_interval_max_seconds{sport}`: maior intervalo dos últimos 5 min (s).
 * - `live_tick_planned_interval_seconds{sport}`: intervalo que o plano pede entre ticks (0 = desconhecido).
 * - `live_tick_paused{sport}`: 1 quando o runner não espera tick de propósito (meio-tempo, orçamento, espera da fonte).
 * - `live_window_open{sport}`: 1 quando o plano do dia tem janela aberta agora.
 * - `live_leader{instance}`: 1 na cópia que tem a trava de líder, 0 nas reservas (só com `LIVE_LEADER=on`).
 */
export function registerLiveTickMetrics(
  registry: Registry,
  db: Database,
  options: LiveTickMetricsOptions = {},
): void {
  const now = options.now ?? (() => new Date());
  const ttl = Math.max(0, options.cacheMs ?? 2_000);
  let pending: Promise<{ rows: LiveTickRow[]; leaders: LiveLeaderRow[] } | null> | undefined;
  let startedAt = 0;

  const load = () => {
    const at = Date.now();
    if (!pending || at - startedAt >= ttl) {
      startedAt = at;
      pending = (async () => {
        try {
          // em sequência: a coleta não aumenta a concorrência no banco
          return { rows: await liveTickRows(db), leaders: await liveLeaders(db) };
        } catch (err) {
          options.onCollectorError?.('live_tick', err);
          return null;
        }
      })();
    }
    return pending;
  };

  const sportGauge = (
    name: string,
    help: string,
    value: (s: LiveTickSample) => number | null,
  ): Gauge<'sport'> => {
    const gauge = new Gauge<'sport'>({
      name,
      help,
      labelNames: ['sport'],
      registers: [registry],
      async collect() {
        const data = await load();
        gauge.reset();
        if (!data) return;
        for (const s of liveTickSamples(data.rows, now())) {
          const v = value(s);
          if (v !== null) gauge.set({ sport: s.sport }, v);
        }
      },
    });
    return gauge;
  };

  sportGauge(
    'live_last_tick_age_seconds',
    'Idade do último tick do ao vivo, de qualquer cópia (s)',
    (s) => s.lastTickAgeSeconds,
  );
  sportGauge(
    'live_tick_interval_seconds',
    'Último intervalo entre ticks do ao vivo (s); atravessa a troca de líder ou de versão',
    (s) => s.intervalSeconds,
  );
  sportGauge(
    'live_tick_interval_max_seconds',
    'Maior intervalo entre ticks do ao vivo nos últimos 5 min (s)',
    (s) => s.intervalMaxSeconds,
  );
  sportGauge(
    'live_tick_planned_interval_seconds',
    'Intervalo que o plano do ao vivo pede entre ticks (s; 0 = desconhecido)',
    (s) => (s.lastTickAgeSeconds === null ? null : s.plannedIntervalSeconds),
  );
  sportGauge(
    'live_tick_paused',
    '1 quando o ao vivo não espera tick de propósito (meio-tempo, orçamento do dia, espera depois de erro da fonte)',
    (s) => (s.lastTickAgeSeconds === null ? null : s.paused ? 1 : 0),
  );
  sportGauge('live_window_open', '1 quando o plano do dia tem janela de jogo aberta agora', (s) =>
    s.windowOpen ? 1 : 0,
  );

  const leader = new Gauge<'instance'>({
    name: 'live_leader',
    help: '1 na cópia que lidera o ao vivo (trava live:leader), 0 nas reservas; só com LIVE_LEADER=on',
    labelNames: ['instance'],
    registers: [registry],
    async collect() {
      const data = await load();
      leader.reset();
      if (!data) return;
      for (const l of data.leaders) leader.set({ instance: l.instance }, l.leader ? 1 : 0);
    },
  });
}
