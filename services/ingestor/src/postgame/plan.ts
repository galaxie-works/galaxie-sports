/**
 * Fechamento pós-jogo: placar e status final dos jogos que o ao vivo não acompanha (os outros esportes e, no
 * futebol, as competições abaixo de LIVE_MIN_PRIORITY), sem esperar a agenda D-1 do sync diário.
 *
 * Por esporte (painel, POSTGAME_<ESPORTE> e POSTGAME_<ESPORTE>_MIN):
 * - `fechamento`: a partir do fim previsto (`ends_at_expected`), a lista do dia (`games?date=` /
 *   `fixtures?date=`, 1 chamada traz todas as ligas) é buscada de novo a cada N minutos até o jogo fechar;
 * - `tempo-real`: o mesmo desde o apito (com N curto, o placar acompanha o jogo);
 * - `off`: nada além da agenda diária.
 * Jogo pendente = começou nas últimas 24 h e ainda não tem o fim confirmado pelo fornecedor (status em
 * andamento, ou `finished` inferido pelo relógio). Cada (esporte, data) tem um cursor em ops.sync_cursor com a
 * última busca; POSTGAME_MAX_CALLS_DAY limita as chamadas por esporte e dia UTC. As chamadas saem na fatia
 * ADHOC do Governor, que respeita a reserva do ao vivo.
 */
import type { ApiSport } from '@galaxie/apisports-client';
import type { Database } from '@galaxie/db';
import { sql } from 'drizzle-orm';
import {
  POSTGAME_APIS,
  POSTGAME_MODES,
  postgameIntervalKey,
  postgameModeKey,
  type PostgameMode,
} from '@galaxie/runtime-config';
import type { CursorRef, CursorStore } from '../jobs/runtime/cursor-store.js';
import { OTHER_SPORTS_SCHEDULE } from '../jobs/daily-job.js';

const MIN = 60_000;
/** Folga no intervalo: o cron roda a cada minuto, mas o `now` de cada execução atrasa alguns segundos. */
const SLACK_MS = 20_000;
/** Jogo que começou há mais que isto fica para a agenda D-1 (adiado, sem fim na fonte). */
export const LOOKBACK_HOURS = 24;
export const DEFAULT_INTERVAL_MIN = 15;
export const DEFAULT_MAX_CALLS_DAY = 40;
export const POSTGAME_CURSOR_ENDPOINT = 'postgame:list';
export const POSTGAME_CAP_ENDPOINT = 'postgame:cap';
export const POSTGAME_TRIES_ENDPOINT = 'postgame:tries';
export const POSTGAME_HOLD_ENDPOINT = 'postgame:hold';
/** Buscas da lista de uma data sem fechar todos os jogos: depois disso a data fica para a agenda D-1. */
export const MAX_TRIES_PER_DATE = 12;
/** Esporte com a cota ADHOC negada fica este tempo sem tentar (nem registrar execução). */
export const HOLD_AFTER_QUOTA_MS = 60 * 60_000;

export interface PostgameSport {
  sport: ApiSport;
  mode: Exclude<PostgameMode, 'off'>;
  intervalMin: number;
}

/** Esportes ligados no painel (modo ≠ off), com o intervalo de cada um. */
export function postgameSports(env: NodeJS.ProcessEnv = process.env): PostgameSport[] {
  const out: PostgameSport[] = [];
  for (const api of POSTGAME_APIS) {
    const raw = env[postgameModeKey(api)]?.trim() || 'fechamento';
    const mode = (POSTGAME_MODES as readonly string[]).includes(raw) ? (raw as PostgameMode) : 'fechamento';
    if (mode === 'off') continue;
    const n = Number(env[postgameIntervalKey(api)]);
    const intervalMin = Number.isInteger(n) && n >= 1 ? Math.min(n, 180) : DEFAULT_INTERVAL_MIN;
    out.push({ sport: api as ApiSport, mode, intervalMin });
  }
  return out;
}

export function maxCallsPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.POSTGAME_MAX_CALLS_DAY);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_CALLS_DAY;
}

/** Endpoint da lista do dia do esporte (a mesma da agenda diária). */
export function listEndpoint(sport: ApiSport): string {
  return sport === 'football'
    ? '/fixtures'
    : OTHER_SPORTS_SCHEDULE[sport as keyof typeof OTHER_SPORTS_SCHEDULE];
}

export interface PendingDay {
  sport: ApiSport;
  /** Data UTC do apito (YYYY-MM-DD): o `date=` da lista. */
  date: string;
  pending: number;
}

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };

/**
 * Jogos pendentes por esporte e data. No futebol, só os de competição abaixo de `liveMinPriority` (os de cima o
 * ao vivo acompanha, e a reconciliação dele confirma).
 */
export async function pendingDays(
  db: Database,
  sports: readonly PostgameSport[],
  now: Date,
  liveMinPriority: string = 'medium',
): Promise<PendingDay[]> {
  if (!sports.length) return [];
  const fromStart = sports.filter((s) => s.mode === 'tempo-real').map((s) => s.sport);
  const fromEnd = sports.filter((s) => s.mode === 'fechamento').map((s) => s.sport);
  const minRank = PRIORITY_RANK[liveMinPriority] ?? 2;
  // ISO com cast: o Date cru vai como texto local (toString) e o Postgres recusa
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000).toISOString();
  const at = now.toISOString();
  const list = (xs: string[]) =>
    xs.length
      ? sql.join(
          xs.map((x) => sql`${x}`),
          sql`, `,
        )
      : sql`null`;
  const rows = await db.execute<{ sport: string; d: string; n: number }>(sql`
    select e.sport, to_char(e.starts_at at time zone 'UTC', 'YYYY-MM-DD') as d, count(*)::int as n
    from core.event e
    left join core.competition c on c.id = e.competition_id
    where e.starts_at >= ${since}::timestamptz and e.starts_at <= ${at}::timestamptz
      and (e.status in ('scheduled', 'starting', 'live', 'break', 'suspended')
           or (e.status = 'finished' and e.status_source = 'temporal'))
      and ((e.sport in (${list(fromStart)}))
           or (e.sport in (${list(fromEnd)}) and e.ends_at_expected <= ${at}::timestamptz))
      and (e.sport <> 'football'
           or (case coalesce(c.live_priority, 'none')
                 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end) < ${minRank})
    group by 1, 2
    order by 1, 2`);
  return rows.map((r) => ({ sport: r.sport as ApiSport, date: r.d, pending: Number(r.n) }));
}

export const listCursor = (sport: string, date: string): CursorRef => ({
  sport,
  endpoint: POSTGAME_CURSOR_ENDPOINT,
  key: `date=${date}`,
});
export const capCursor = (sport: string, day: string): CursorRef => ({
  sport,
  endpoint: POSTGAME_CAP_ENDPOINT,
  key: `day=${day}`,
});

export const triesCursor = (sport: string, date: string): CursorRef => ({
  sport,
  endpoint: POSTGAME_TRIES_ENDPOINT,
  key: `date=${date}`,
});
export const holdCursor = (sport: string): CursorRef => ({
  sport,
  endpoint: POSTGAME_HOLD_ENDPOINT,
  key: 'hold',
});

const idOf = (r: CursorRef) => `${r.sport}|${r.endpoint}|${r.key}`;

export interface DueList {
  sport: ApiSport;
  date: string;
  pending: number;
}

/**
 * Datas na vez: a última busca da lista (esporte, data) foi há pelo menos o intervalo do esporte, o esporte não
 * está em espera por cota negada, a data ainda não passou de MAX_TRIES_PER_DATE buscas e o esporte ainda tem
 * chamadas no dia. Cada esporte gasta no máximo o que sobra do teto; as datas mais antigas primeiro.
 */
export async function dueLists(
  cursors: CursorStore,
  sports: readonly PostgameSport[],
  pending: readonly PendingDay[],
  now: Date,
  maxPerDay: number,
): Promise<{ due: DueList[]; capped: ApiSport[]; held: ApiSport[]; exhausted: DueList[] }> {
  const today = now.toISOString().slice(0, 10);
  const bySport = new Map(sports.map((s) => [s.sport, s] as const));
  const sportIds = [...new Set(pending.map((p) => p.sport))];
  const refs = pending.flatMap((p) => [listCursor(p.sport, p.date), triesCursor(p.sport, p.date)]);
  const caps = sportIds.map((s) => capCursor(s, today));
  const holds = sportIds.map((s) => holdCursor(s));
  const state = await cursors.load([...refs, ...caps, ...holds]);
  const used = new Map<string, number>();
  for (const c of caps) {
    const n = state.get(idOf(c))?.cursor?.calls;
    used.set(c.sport, typeof n === 'number' ? n : 0);
  }
  const heldSet = new Set<ApiSport>();
  for (const h of holds) {
    const until = state.get(idOf(h))?.cursor?.until;
    if (typeof until === 'string' && Date.parse(until) > now.getTime()) heldSet.add(h.sport as ApiSport);
  }
  const due: DueList[] = [];
  const exhausted: DueList[] = [];
  const capped = new Set<ApiSport>();
  for (const p of pending) {
    const cfg = bySport.get(p.sport);
    if (!cfg || heldSet.has(p.sport)) continue;
    const tries = state.get(idOf(triesCursor(p.sport, p.date)))?.cursor?.n;
    if (typeof tries === 'number' && tries >= MAX_TRIES_PER_DATE) {
      exhausted.push({ sport: p.sport, date: p.date, pending: p.pending });
      continue;
    }
    const last = state.get(idOf(listCursor(p.sport, p.date)))?.completedAt;
    if (last && now.getTime() - last.getTime() < cfg.intervalMin * MIN - SLACK_MS) continue;
    const spent = used.get(p.sport) ?? 0;
    if (spent >= maxPerDay) {
      capped.add(p.sport);
      continue;
    }
    used.set(p.sport, spent + 1);
    due.push({ sport: p.sport, date: p.date, pending: p.pending });
  }
  return { due, capped: [...capped], held: [...heldSet], exhausted };
}

/** Põe o esporte em espera depois de uma cota negada: nada é tentado (nem registrado) até `until`. */
export async function holdSport(cursors: CursorStore, sport: string, now: Date): Promise<void> {
  const until = new Date(now.getTime() + HOLD_AFTER_QUOTA_MS).toISOString();
  await cursors.complete([holdCursor(sport)], { until }, now);
}

/** Soma uma tentativa em cada (esporte, data) cuja lista saiu para o fornecedor. */
export async function recordTries(
  cursors: CursorStore,
  fetched: readonly DueList[],
  now: Date,
): Promise<void> {
  if (!fetched.length) return;
  const refs = fetched.map((d) => triesCursor(d.sport, d.date));
  const state = await cursors.load(refs);
  for (const ref of refs) {
    const prev = state.get(idOf(ref))?.cursor?.n;
    await cursors.complete([ref], { n: (typeof prev === 'number' ? prev : 0) + 1 }, now);
  }
}

/** Soma no cursor do teto de cada esporte as chamadas que de fato saíram para o fornecedor nesta execução. */
export async function recordCalls(
  cursors: CursorStore,
  calls: ReadonlyMap<string, number>,
  now: Date,
): Promise<void> {
  const today = now.toISOString().slice(0, 10);
  const spent = [...calls].filter(([, n]) => n > 0);
  if (!spent.length) return;
  const refs = spent.map(([sport]) => capCursor(sport, today));
  const state = await cursors.load(refs);
  for (const [sport, n] of spent) {
    const ref = capCursor(sport, today);
    const prev = state.get(`${ref.sport}|${ref.endpoint}|${ref.key}`)?.cursor?.calls;
    await cursors.complete([ref], { calls: (typeof prev === 'number' ? prev : 0) + n }, now);
  }
}
