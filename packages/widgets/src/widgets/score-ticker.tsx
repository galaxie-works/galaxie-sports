'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  LIVE_STATUSES,
  STARTED_STATUSES,
  isoDate,
  liveClockText,
  localTimeZone,
  sidesOf,
  type GsEvent,
  type GsEventList,
  type GsParticipant,
} from '../core/model.js';
import { Crest, WidgetFrame, useFormatters, useGalaxieQuery, useGalaxieWidget } from '../core/react.js';

/** O que a faixa mostra: só os jogos em andamento, também os encerrados do dia ou o dia todo. */
export type ScoreTickerMode = 'live' | 'today' | 'all';
/** Velocidade da rolagem (a mesma leitura em qualquer tamanho de tela: anda em "letras por segundo"). */
export type ScoreTickerSpeed = 'slow' | 'normal' | 'fast';

export interface ScoreTickerProps {
  /** UUID ou slug da competição; sem ela, todas as do plano. */
  competitionId?: string | undefined;
  /** Esporte da API (`football`, `basketball`...); sem ele, todos os esportes do plano. */
  sport?: string | undefined;
  /** `live` = só ao vivo; `today` = ao vivo e encerrados do dia (padrão); `all` = inclui os próximos. */
  mode?: ScoreTickerMode | undefined;
  speed?: ScoreTickerSpeed | undefined;
  /** Fundo e borda transparentes, para sobrepor ao vídeo da emissora. */
  transparent?: boolean | undefined;
  /** Rótulo fixo à esquerda ("Ao vivo agora", "Jogos do dia"). */
  showLabel?: boolean | undefined;
  /** Nome do campeonato antes dos jogos dele. */
  showCompetition?: boolean | undefined;
  /** Escudos dos times. */
  showCrests?: boolean | undefined;
  /** `short` = sigla ou nome curto (padrão, cabe mais na faixa); `full` = nome completo. */
  teamName?: 'short' | 'full' | undefined;
  /** Máximo de jogos na faixa (1–100, padrão 40). */
  limit?: number | undefined;
}

export const SCORE_TICKER_LIMIT = { min: 1, max: 100, default: 40 } as const;

/** Rolagem em em/s: a distância acompanha o tamanho da letra, então a leitura é igual no celular e na TV. */
const SPEED_EM_PER_SEC: Record<ScoreTickerSpeed, number> = { slow: 2.5, normal: 4, fast: 6 };
const LIVE_REFRESH_MS = 20_000;
const IDLE_REFRESH_MS = 120_000;
const RETRY_MS = 30_000;
const RETRY_MAX_MS = 5 * 60_000;
const STALE_RETRY_MS = 15_000;
const STALE_MAX_TRIES = 8;
/** Erros que podem passar sozinhos: rede (0), timeout, limite de requisições e falha do servidor. */
const isTransient = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;
const TODAY_STATUSES = 'starting,live,break,finished';

/** Em andamento primeiro, depois encerrados, depois os próximos; dentro de cada, pelo horário. */
const stageOf = (e: GsEvent) =>
  LIVE_STATUSES.has(e.status) || e.status === 'starting' ? 0 : e.status === 'finished' ? 1 : 2;

interface Group {
  key: string;
  id: string;
  name: string;
  logo: string | null;
  events: GsEvent[];
}

/**
 * Faixa de placares para TV: os jogos ao vivo (e, se quiser, os encerrados e os próximos do dia) correndo
 * numa linha, agrupados por campeonato. Letra proporcional à largura (legível a 3 m numa TV 1080p), fundo
 * transparente opcional para sobrepor ao vídeo, pausa ao passar o mouse e parada com "reduzir movimento".
 * Atualiza a cada 20 s enquanto houver jogo em andamento.
 */
export function ScoreTicker({
  competitionId,
  sport,
  mode = 'today',
  speed = 'normal',
  transparent = false,
  showLabel = true,
  showCompetition = true,
  showCrests = true,
  teamName = 'short',
  limit = SCORE_TICKER_LIMIT.default,
}: ScoreTickerProps) {
  const { texts, timeZone, market } = useGalaxieWidget();
  const fmt = useFormatters();
  const max = Math.min(
    Math.max(Math.trunc(limit) || SCORE_TICKER_LIMIT.default, SCORE_TICKER_LIMIT.min),
    SCORE_TICKER_LIMIT.max,
  );
  const liveOnly = mode === 'live';
  const today = isoDate(new Date(), timeZone ?? localTimeZone());
  const inPlay = (list: GsEventList) =>
    list.data.some((e) => LIVE_STATUSES.has(e.status) || e.status === 'starting')
      ? LIVE_REFRESH_MS
      : IDLE_REFRESH_MS;
  // os ao vivo vêm sempre da rota própria: no /v1/events do dia o teto de 100 corta pelo horário, e um
  // jogo ao vivo mais tarde num dia cheio ficaria de fora
  const live = useGalaxieQuery<GsEventList>(
    '/v1/events/live',
    { competition: competitionId, sport, market },
    inPlay,
  );
  const day = useGalaxieQuery<GsEventList>(
    liveOnly ? null : '/v1/events',
    {
      competition: competitionId,
      sport,
      market,
      date: today,
      status: mode === 'today' ? TODAY_STATUSES : undefined,
      limit: SCORE_TICKER_LIMIT.max,
    },
    // os ao vivo já atualizam a cada 20 s pela rota própria: o dia só precisa do ritmo calmo
    () => IDLE_REFRESH_MS,
  );
  // uma TV fica horas sem ninguém tocar: erro na primeira carga (um 429, a rede caindo) tenta de novo sozinho
  useRetryOnError(live);
  useRetryOnError(day);
  // jogo que saiu do ao vivo (apito final): busca o dia de novo para trocar a cópia velha pelo encerrado
  const liveIds = (live.data?.data ?? []).map((e) => e.id).join(',');
  const prevLiveIds = useRef(liveIds);
  const dayRetry = day.retry;
  useEffect(() => {
    const before = prevLiveIds.current.split(',').filter(Boolean);
    prevLiveIds.current = liveIds;
    const now = new Set(liveIds.split(','));
    if (!liveOnly && before.some((id) => !now.has(id))) dayRetry();
  }, [liveIds, liveOnly, dayRetry]);
  // mostra o que chegou: com uma das duas consultas fora, a faixa segue com a outra
  const ready = Boolean(live.data || (!liveOnly && day.data));
  const liveSet = live.data ? new Set(live.data.data.map((e) => e.id)) : null;
  // jogo com bola rolando no dia que a rota ao vivo já não traz: terminou, e a cópia do dia está velha (o
  // cache do /v1/events ainda pode servi-la por alguns segundos). `starting` não entra: a rota ao vivo só
  // traz o jogo depois do apito inicial
  const isStale = (e: GsEvent) => Boolean(liveSet) && LIVE_STATUSES.has(e.status) && !liveSet!.has(e.id);
  const staleKey = (day.data?.data ?? [])
    .filter(isStale)
    .map((e) => e.id)
    .join(',');
  // enquanto o dia ainda trouxer a cópia velha, busca de novo a cada 15 s (no máximo 8 vezes por jogo)
  const staleTries = useRef({ key: '', n: 0 });
  useEffect(() => {
    if (!staleKey || liveOnly) return;
    const tries = staleTries.current;
    if (tries.key !== staleKey) staleTries.current = { key: staleKey, n: 0 };
    if (staleTries.current.n >= STALE_MAX_TRIES) return;
    const timer = setTimeout(() => {
      staleTries.current.n += 1;
      dayRetry();
    }, STALE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [staleKey, liveOnly, dayRetry, day.data]);

  const seen = new Set<string>();
  const dayEvents = (day.data?.data ?? []).filter((e) => !isStale(e));
  const sorted = [...(live.data?.data ?? []), ...dayEvents]
    .filter((e) => !seen.has(e.id) && Boolean(seen.add(e.id)))
    .filter((e) => (liveOnly ? stageOf(e) === 0 : mode === 'today' ? stageOf(e) < 2 : true))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => stageOf(a.e) - stageOf(b.e) || a.e.starts_at.localeCompare(b.e.starts_at) || a.i - b.i)
    .map(({ e }) => e);
  // dentro de cada estágio (ao vivo, encerrados, próximos), os jogos do mesmo campeonato ficam juntos, na
  // ordem em que o campeonato aparece; o ao vivo de qualquer campeonato continua antes dos encerrados
  const firstAt = new Map<string, number>();
  sorted.forEach((e, i) => {
    const key = `${stageOf(e)}:${e.competition?.id ?? 'other'}`;
    if (!firstAt.has(key)) firstAt.set(key, i);
  });
  const events = sorted
    .map((e, i) => ({ e, i, g: firstAt.get(`${stageOf(e)}:${e.competition?.id ?? 'other'}`)! }))
    .sort((a, b) => a.g - b.g || a.i - b.i)
    .map(({ e }) => e)
    .slice(0, max);

  // grupos consecutivos: o mesmo campeonato pode reaparecer (ao vivo e depois encerrados)
  const single = Boolean(competitionId);
  const groups: Group[] = [];
  for (const event of events) {
    const id = event.competition?.id ?? 'other';
    const last = groups.at(-1);
    if (last && last.id === id) last.events.push(event);
    else
      groups.push({
        key: `${groups.length}:${id}`,
        id,
        name: event.competition?.name ?? '',
        logo: event.competition?.logo ?? null,
        events: [event],
      });
  }

  const label = liveOnly ? texts.liveNow : texts.todayGames;
  const loading = live.loading || day.loading;
  const empty = !ready
    ? loading
      ? texts.loading
      : texts.error
    : events.length === 0
      ? liveOnly
        ? texts.emptyLive
        : texts.emptyDay
      : null;

  return (
    <WidgetFrame kind="score_ticker" busy={loading}>
      <div className="gs-ticker" data-transparent={transparent || undefined}>
        {showLabel ? (
          <div className="gs-ticker-label">
            {groups.some((g) => g.events.some((e) => stageOf(e) === 0)) ? (
              <span className="gs-dot" aria-hidden="true" />
            ) : null}
            <span>{label}</span>
          </div>
        ) : null}
        {empty ? (
          <div className="gs-ticker-empty" role={ready ? undefined : 'status'}>
            {empty}
          </div>
        ) : (
          <Marquee speed={SPEED_EM_PER_SEC[speed] ?? SPEED_EM_PER_SEC.normal} label={label}>
            {groups.map((group) => (
              <li key={group.key} className="gs-ticker-group">
                {showCompetition && group.name && !single ? (
                  <span className="gs-ticker-competition">
                    {showCrests ? <Crest src={group.logo} name={group.name} size="xs" /> : null}
                    <span>{group.name}</span>
                  </span>
                ) : null}
                {group.events.map((event) => (
                  <TickerItem
                    key={event.id}
                    event={event}
                    crests={showCrests}
                    short={teamName === 'short'}
                    time={fmt.time(event.starts_at)}
                  />
                ))}
              </li>
            ))}
          </Marquee>
        )}
      </div>
    </WidgetFrame>
  );
}

/**
 * A linha que corre. O conteúdo vai duas vezes (a cópia escondida dos leitores de tela) e a animação anda
 * metade da trilha, então o fim emenda no começo sem salto. Só corre quando não cabe na largura.
 */
function Marquee({ speed, label, children }: { speed: number; label: string; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const items = useRef<HTMLUListElement>(null);
  const [run, setRun] = useState<{ seconds: number } | null>(null);

  useEffect(() => {
    const vp = viewport.current;
    const list = items.current;
    if (!vp || !list) return;
    const measure = () => {
      const width = list.scrollWidth;
      const fontPx = parseFloat(getComputedStyle(list).fontSize) || 16;
      if (!width || width <= vp.clientWidth) return setRun(null);
      // segundos inteiros: pequenas mudanças de largura (um gol) não reiniciam a animação
      const seconds = Math.max(4, Math.round(width / (fontPx * speed)));
      setRun((prev) => (prev?.seconds === seconds ? prev : { seconds }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(vp);
    observer.observe(list);
    return () => observer.disconnect();
  }, [speed, children]);

  return (
    <div ref={viewport} className="gs-ticker-viewport" role="region" aria-label={label}>
      <div
        className="gs-ticker-track"
        data-running={run ? '' : undefined}
        style={run ? { animationDuration: `${run.seconds}s` } : undefined}
      >
        <ul ref={items} className="gs-ticker-items">
          {children}
        </ul>
        {run ? (
          <ul className="gs-ticker-items" aria-hidden="true">
            {children}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function TickerItem({
  event,
  crests,
  short,
  time,
}: {
  event: GsEvent;
  crests: boolean;
  short: boolean;
  time: string;
}) {
  const { texts } = useGalaxieWidget();
  const live = LIVE_STATUSES.has(event.status) || event.status === 'starting';
  const started = STARTED_STATUSES.has(event.status);
  const status = live
    ? ((event.status === 'live' ? liveClockText(event, texts) : null) ?? texts.status[event.status])
    : event.status === 'scheduled'
      ? time
      : (texts.status[event.status] ?? event.status);
  const race = event.participants.some((p) => p.side === 'grid');
  if (race) {
    // corrida: o GP e a sessão, com o líder (ou o vencedor) quando já largou
    const leader = started ? event.participants.find((p) => p.position === 1) : undefined;
    return (
      <span className="gs-ticker-item" data-gs-event={event.id} data-live={live || undefined}>
        <span className="gs-ticker-status">{status}</span>
        <span>{[event.stage?.name, event.session?.name].filter(Boolean).join(' · ')}</span>
        {leader ? <strong>{`1º ${nameOf(leader, short)}`}</strong> : null}
      </span>
    );
  }
  const { home, away } = sidesOf(event);
  const score = (n: number | null | undefined) => (started && n !== null && n !== undefined ? n : null);
  const h = score(event.score.home);
  const a = score(event.score.away);
  return (
    <span className="gs-ticker-item" data-gs-event={event.id} data-live={live || undefined}>
      <span className="gs-ticker-status">{status}</span>
      <Side p={home} crests={crests} short={short} lost={home?.winner === false} />
      <strong className="gs-ticker-score">{h !== null && a !== null ? `${h} – ${a}` : '×'}</strong>
      <Side p={away} crests={crests} short={short} lost={away?.winner === false} reverse />
    </span>
  );
}

function nameOf(p: GsParticipant, short: boolean): string {
  return (short && p.short_name) || p.name;
}

function Side({
  p,
  crests,
  short,
  lost,
  reverse = false,
}: {
  p: GsParticipant | undefined;
  crests: boolean;
  short: boolean;
  lost: boolean;
  reverse?: boolean;
}) {
  if (!p) return null;
  const crest = crests ? <Crest src={p.logo} name={p.name} size="sm" /> : null;
  return (
    <span className="gs-ticker-team" data-lost={lost || undefined}>
      {reverse ? null : crest}
      <span>{nameOf(p, short)}</span>
      {reverse ? crest : null}
    </span>
  );
}

/**
 * Primeira carga com erro passageiro (rede, 408, 429, 5xx): tenta de novo sozinha, com espera crescente
 * (30 s, 1 min, 2 min... até 5 min) e um pouco de sorteio, para as TVs não voltarem todas juntas. Com a aba
 * escondida, espera ela aparecer. Chave inválida ou sem permissão não passa sozinha: fica no erro.
 * Com dados na tela, o polling normal já cuida.
 */
function useRetryOnError(query: {
  data: unknown;
  error: { status: number } | null;
  loading: boolean;
  retry: () => void;
}) {
  const failed = !query.data && !query.loading && query.error !== null && isTransient(query.error.status);
  const attempts = useRef(0);
  const hasData = Boolean(query.data);
  useEffect(() => {
    if (hasData) attempts.current = 0;
  }, [hasData]);
  const { retry } = query;
  useEffect(() => {
    if (!failed) return;
    const base = Math.min(RETRY_MS * 2 ** attempts.current, RETRY_MAX_MS);
    const delay = base * (0.75 + Math.random() * 0.5);
    const fire = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        document.addEventListener('visibilitychange', fire, { once: true });
        return;
      }
      attempts.current += 1;
      retry();
    };
    const timer = setTimeout(fire, delay);
    return () => {
      clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', fire);
    };
  }, [failed, retry]);
}
