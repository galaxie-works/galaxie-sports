/**
 * Agendamento do onde assistir (docs/07 §2.2). Por jogo × mercado com direitos conhecidos:
 *
 *   T-7d    rights      publica a resposta da tabela de direitos (determinístico, sem LLM)
 *   T-48h   allocate    alocação por RODADA: abre 48 h antes do primeiro jogo da rodada; uma única
 *                       chamada cobre todos os jogos e mercados do grupo — e só se os direitos
 *                       dividem os jogos e a relevância passa do limiar
 *   T-3h    revalidate  refaz o fetch das URLs salvas e reaplica os direitos (sem LLM)
 *   T-30min revalidate  idem
 *
 * Jogo de competição sem direitos (curados ou pesquisados) no mercado não entra: quem cobre esse
 * buraco é a pesquisa de direitos por temporada (`wtw-rights`). Cada (evento, país, janela) vira um
 * registro idempotente em enrich.wtw_run (`run_key` único).
 */
import { and, asc, eq, gt, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  competition,
  event,
  season,
  stage,
  wtwRun,
  type Database,
  type WtwRunMode,
  type WtwWindow,
} from '@galaxie/db';
import {
  effectiveRights,
  ResearchedRightsIndex,
  type RightsEntry,
  type WtwConfig,
} from '@galaxie/where-to-watch';
import { groupKeyOf, roundKeyOf } from './groups.js';
import { marketRelevance, priorityOf } from './relevance.js';

export interface WindowSpec {
  window: Exclude<WtwWindow, 'manual' | 'T-24h'>;
  offsetMs: number;
  mode: Exclude<WtwRunMode, 'full'>;
  /** event = conta a partir do início do jogo · round = do primeiro jogo da rodada. */
  anchor: 'event' | 'round';
}

const H = 3_600_000;

export const WTW_WINDOWS: WindowSpec[] = [
  { window: 'T-7d', offsetMs: 7 * 24 * H, mode: 'rights', anchor: 'event' },
  { window: 'T-48h', offsetMs: 48 * H, mode: 'allocate', anchor: 'round' },
  { window: 'T-3h', offsetMs: 3 * H, mode: 'revalidate', anchor: 'event' },
  { window: 'T-30min', offsetMs: 0.5 * H, mode: 'revalidate', anchor: 'event' },
];

/**
 * Janela vigente: a que abriu por último (`now ≥ âncora − offset`). Janelas perdidas não são
 * recuperadas — a vigente cobre (a alocação vale até a revalidação de T-3h abrir).
 */
export function dueWindow(startsAt: Date, now: Date, roundStart: Date = startsAt): WindowSpec | null {
  if (now.getTime() >= startsAt.getTime()) return null;
  let due: WindowSpec | null = null;
  let opened = -Infinity;
  for (const w of WTW_WINDOWS) {
    const anchor =
      w.anchor === 'round' ? Math.min(roundStart.getTime(), startsAt.getTime()) : startsAt.getTime();
    const opensAt = anchor - w.offsetMs;
    if (now.getTime() >= opensAt && opensAt >= opened) {
      due = w;
      opened = opensAt;
    }
  }
  return due;
}

export const runKeyOf = (eventId: string, country: string, window: string) =>
  `${eventId}:${country}:${window}`;

export interface DueRun {
  runKey: string;
  eventId: string;
  country: string;
  window: WindowSpec['window'];
  mode: WindowSpec['mode'];
  startsAt: Date;
  tier: number;
  competition: string | null;
  /** competição|rodada — a alocação roda uma vez por grupo, para todos os mercados. */
  group: string;
  round: string;
  season: number;
  relevance: number;
  priority: number;
  rights: RightsEntry;
}

export interface UpcomingEvent {
  id: string;
  startsAt: Date;
  tier: number;
  sport: string;
  slug: string;
  name: string;
  countryCode: string | null;
  round: string | null;
  season: number;
  importance: number;
  participantCountries: (string | null)[];
}

/** Jogos tier ≤ 2 ainda não iniciados no horizonte, com rodada, temporada e países dos times. */
export async function loadUpcomingEvents(
  db: Database,
  opts: { now: Date; horizonMs: number; eventId?: string },
): Promise<UpcomingEvent[]> {
  const conds = [
    gt(event.startsAt, opts.now),
    lte(event.startsAt, new Date(opts.now.getTime() + opts.horizonMs)),
    inArray(event.status, ['scheduled', 'starting']),
    lte(competition.tier, 2),
  ];
  if (opts.eventId) conds.push(eq(event.id, opts.eventId));
  const rows = await db
    .select({
      id: event.id,
      startsAt: event.startsAt,
      tier: competition.tier,
      sport: competition.sport,
      slug: competition.slug,
      name: competition.name,
      countryCode: competition.countryCode,
      round: stage.providerLabel,
      seasonYear: season.year,
      importance: event.importance,
      participantCountries: sql<(string | null)[]>`coalesce((
        select array_agg(p.country_code) from core.event_participant ep
          join core.participant p on p.id = ep.participant_id
         where ep.event_id = ${event.id}), '{}')`,
    })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .leftJoin(stage, eq(stage.id, event.stageId))
    .leftJoin(season, eq(season.id, event.seasonId))
    .where(and(...conds))
    .orderBy(asc(event.startsAt));
  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    tier: r.tier,
    sport: r.sport,
    slug: r.slug,
    name: r.name,
    countryCode: r.countryCode,
    round: r.round,
    season: r.seasonYear ?? r.startsAt.getUTCFullYear(),
    importance: r.importance,
    participantCountries: r.participantCountries ?? [],
  }));
}

/** Início do primeiro jogo de cada grupo (competição × rodada). */
export function roundStarts(events: UpcomingEvent[]): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const e of events) {
    const g = groupKeyOf(e.slug, roundKeyOf(e.round, e.startsAt));
    const cur = out.get(g);
    if (!cur || e.startsAt < cur) out.set(g, e.startsAt);
  }
  return out;
}

/** Direitos efetivos do jogo no mercado (curada > pesquisada). */
export function rightsForEvent(
  config: WtwConfig,
  researched: ResearchedRightsIndex,
  e: Pick<UpcomingEvent, 'slug' | 'startsAt' | 'season'>,
  country: string,
): RightsEntry | null {
  if (!config.has(country)) return null;
  return effectiveRights(
    config.directory(country).rightsFor(e.slug, e.startsAt),
    researched.get(e.slug, e.season, country),
  );
}

export interface PlanOptions {
  now: Date;
  markets: string[];
  config: WtwConfig;
  researched: ResearchedRightsIndex;
  eventId?: string;
  /** Horizonte de busca de eventos (padrão 7 dias + folga). */
  horizonMs?: number;
}

/** Execuções devidas agora e ainda não registradas. */
export async function planDueRuns(db: Database, opts: PlanOptions): Promise<DueRun[]> {
  const horizon = opts.horizonMs ?? 7 * 24 * H + 5 * 60_000;
  const events = await loadUpcomingEvents(db, {
    now: opts.now,
    horizonMs: horizon,
    ...(opts.eventId ? { eventId: opts.eventId } : {}),
  });
  const starts = roundStarts(events);
  const due: DueRun[] = [];
  for (const e of events) {
    const round = roundKeyOf(e.round, e.startsAt);
    const group = groupKeyOf(e.slug, round);
    const w = dueWindow(e.startsAt, opts.now, starts.get(group));
    if (!w) continue;
    for (const country of opts.markets) {
      const rights = rightsForEvent(opts.config, opts.researched, e, country);
      if (!rights) continue;
      const relevance = marketRelevance(
        {
          importance: e.importance,
          participantCountries: e.participantCountries,
          competitionCountry: e.countryCode,
          competition: { sport: e.sport, slug: e.slug },
        },
        country,
      );
      due.push({
        runKey: runKeyOf(e.id, country, w.window),
        eventId: e.id,
        country,
        window: w.window,
        mode: w.mode,
        startsAt: e.startsAt,
        tier: e.tier,
        competition: e.slug,
        group,
        round,
        season: e.season,
        relevance,
        priority: priorityOf(relevance, e.startsAt, opts.now),
        rights,
      });
    }
  }
  if (!due.length) return due;
  const existing = await db
    .select({ runKey: wtwRun.runKey })
    .from(wtwRun)
    .where(
      inArray(
        wtwRun.runKey,
        due.map((d) => d.runKey),
      ),
    );
  const done = new Set(existing.map((r) => r.runKey));
  return due.filter((d) => !done.has(d.runKey));
}

/** Registra as execuções devidas (idempotente: `run_key` único). Retorna quantas entraram. */
export async function enqueueRuns(db: Database, due: DueRun[], now: Date): Promise<number> {
  if (!due.length) return 0;
  let n = 0;
  for (let i = 0; i < due.length; i += 500) {
    const rows = await db
      .insert(wtwRun)
      .values(
        due.slice(i, i + 500).map((d) => ({
          runKey: d.runKey,
          eventId: d.eventId,
          countryCode: d.country,
          window: d.window,
          mode: d.mode,
          status: 'queued',
          requestedBy: 'scheduler',
          scheduledFor: now,
          stats: { relevance: d.relevance, priority: d.priority, group: d.group },
        })),
      )
      .onConflictDoNothing({ target: wtwRun.runKey })
      .returning({ id: wtwRun.id });
    n += rows.length;
  }
  return n;
}

export type WtwRunRow = typeof wtwRun.$inferSelect;

/**
 * Reserva execuções enfileiradas (queued → running) com `FOR UPDATE SKIP LOCKED`, por prioridade
 * (relevância × proximidade do início). As irmãs de uma alocação (mesmo grupo, outros jogos e
 * mercados) vêm junto: a rodada é pesquisada uma vez só.
 */
export async function claimRuns(
  db: Database,
  opts: { now: Date; limit: number; eventId?: string; country?: string },
): Promise<WtwRunRow[]> {
  const filters = [sql`status = 'queued'`, sql`scheduled_for <= ${opts.now.toISOString()}::timestamptz`];
  if (opts.eventId) filters.push(sql`event_id = ${opts.eventId}`);
  if (opts.country) filters.push(sql`country_code = ${opts.country}`);
  const ids = await db.execute<{ id: string; grp: string | null }>(sql`
    select id, case when mode = 'allocate' then stats->>'group' end as grp from enrich.wtw_run
     where ${sql.join(filters, sql` and `)}
     order by coalesce((stats->>'priority')::numeric, 0) desc, scheduled_for, created_at
     limit ${opts.limit}
     for update skip locked`);
  if (!ids.length) return [];
  const groups = [...new Set(ids.map((r) => r.grp).filter((g): g is string => !!g))];
  const siblings = groups.length
    ? await db.execute<{ id: string }>(sql`
        select id from enrich.wtw_run
         where status = 'queued' and mode = 'allocate'
           and scheduled_for <= ${opts.now.toISOString()}::timestamptz
           and stats->>'group' in (${sql.join(
             groups.map((g) => sql`${g}`),
             sql`, `,
           )})
           ${opts.country ? sql`and country_code = ${opts.country}` : sql``}
         limit 500
         for update skip locked`)
    : [];
  const all = [...new Set([...ids.map((r) => r.id), ...siblings.map((r) => r.id)])];
  return db
    .update(wtwRun)
    .set({ status: 'running', startedAt: opts.now, stats: withAttempts(sql`${attemptsOf} + 1`) })
    .where(and(inArray(wtwRun.id, all), eq(wtwRun.status, 'queued')))
    .returning();
}

/**
 * Tentativas de uma execução: cada reserva (queued → running) conta uma, em `stats.attempts`; a reserva que voltou
 * para a fila sem tentar (rodada sem chamada disponível) devolve a sua. Uma execução que derruba o worker ou estoura o
 * tempo volta para a fila com espera crescente (15 min, 30 min…) e, na WTW_RUN_MAX_ATTEMPTS-ésima vez, fecha como
 * `failed` com o motivo, em vez de voltar para sempre gastando IA. O estado aparece no admin do onde assistir (status,
 * error e stats.attempts de cada execução).
 */
export const WTW_RUN_MAX_ATTEMPTS = 3;
const STALE_BACKOFF_MIN = 15;

export const attemptsOf = sql<number>`coalesce((${wtwRun.stats} ->> 'attempts')::int, 0)`;
export const withAttempts = (value: SQL) =>
  sql`coalesce(${wtwRun.stats}, '{}'::jsonb) || jsonb_build_object('attempts', ${value})`;

/** Tentativas já feitas de uma execução reservada (`stats.attempts`). */
export const attemptsOfRow = (run: Pick<WtwRunRow, 'stats'>): number => {
  const n = Number((run.stats as Record<string, unknown> | null)?.attempts);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Execuções que ficaram `running` por mais de `staleMs` (worker caiu, tempo do job estourou): voltam para a fila com
 * espera crescente, ou fecham como `failed` depois de WTW_RUN_MAX_ATTEMPTS tentativas.
 */
export async function requeueStale(
  db: Database,
  now: Date,
  staleMs = 30 * 60_000,
): Promise<{ requeued: number; failed: number }> {
  const stale = and(eq(wtwRun.status, 'running'), lte(wtwRun.startedAt, new Date(now.getTime() - staleMs)));
  const failed = await db
    .update(wtwRun)
    .set({
      status: 'failed',
      finishedAt: now,
      error: sql`'desistiu depois de ' || ${attemptsOf} || ' tentativas sem terminar (o worker caiu ou o job estourou o tempo)'`,
    })
    .where(and(stale, sql`${attemptsOf} >= ${WTW_RUN_MAX_ATTEMPTS}`))
    .returning({ id: wtwRun.id });
  const requeued = await db
    .update(wtwRun)
    .set({
      status: 'queued',
      startedAt: null,
      scheduledFor: sql`${now.toISOString()}::timestamptz + make_interval(mins => ${STALE_BACKOFF_MIN} * power(2, greatest(${attemptsOf} - 1, 0))::int)`,
    })
    .where(stale)
    .returning({ id: wtwRun.id });
  return { requeued: requeued.length, failed: failed.length };
}
