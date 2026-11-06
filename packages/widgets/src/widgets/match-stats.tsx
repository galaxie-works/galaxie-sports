'use client';

import {
  eventRefreshMs,
  intlLocale,
  sidesOf,
  STARTED_STATUSES,
  type GsEvent,
  type GsEventStats,
} from '../core/model.js';
import {
  Crest,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  WidgetFrame,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface MatchStatsProps {
  /** Id do evento na API Galaxie. */
  eventId: string;
  /**
   * Estatísticas a mostrar, na ordem, pelos códigos estáveis da API separados por vírgula
   * (`possession_pct,shots_total,corners`). Ausente: a ordem padrão e, depois, as do fornecedor ainda sem código.
   */
  stats?: string | undefined;
  /** Quantas linhas no máximo (padrão 8; 0 = todas). */
  limit?: number | undefined;
  /** Escudos e nomes dos times no topo (padrão: sim). */
  showTeams?: boolean | undefined;
  /** Barra com a proporção de cada lado (padrão: sim). */
  showBars?: boolean | undefined;
  /** Destaque no melhor valor da linha (o menor em faltas, impedimentos e cartões) (padrão: sim). */
  highlightBest?: boolean | undefined;
}

/** Ordem padrão (a mesma da página do jogo no site). */
export const MATCH_STATS_DEFAULT_ORDER: readonly string[] = [
  'possession_pct',
  'shots_total',
  'shots_on_goal',
  'xg',
  'passes_total',
  'pass_accuracy_pct',
  'corners',
  'fouls',
  'offsides',
  'yellow_cards',
  'red_cards',
  'saves',
];

/** Onde menor é melhor: o destaque vai para o menor valor. */
const LOWER_IS_BETTER = new Set(['fouls', 'offsides', 'yellow_cards', 'red_cards']);
/** Valores que não são contagem: sem número, a linha fica com "–" (contagens sem valor viram 0). */
const NOT_COUNTS = new Set(['xg', 'possession_pct', 'pass_accuracy_pct', 'goals_prevented']);
const PERCENT = new Set(['possession_pct', 'pass_accuracy_pct']);

type Stat = GsEventStats['teams'][number]['statistics'][number];

export interface MatchStatRow {
  /** Código estável ou, nas do fornecedor ainda sem código, o `type` cru. */
  key: string;
  label: string;
  home: number | null;
  away: number | null;
  /** Lado com o melhor valor, ou null no empate (ou sem número de um lado). */
  best: 'home' | 'away' | null;
  /** Fração do mandante (0–1) para a barra; null sem barra. */
  share: number | null;
  percent: boolean;
}

const statKey = (s: Stat) => s.code ?? s.type ?? null;

function numberOf(s: Stat | undefined): number | null {
  if (!s) return null;
  if (typeof s.numeric === 'number') return s.numeric;
  if (typeof s.value === 'number') return s.value;
  if (typeof s.value === 'string') {
    const n = Number.parseFloat(s.value.replace('%', '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Linhas da estatística do jogo: na ordem pedida (ou na padrão, com as do fornecedor ainda sem código no
 * fim), só as que têm valor, até `limit` (0 = todas). Vale para qualquer esporte que a API traga.
 */
export function matchStatRows(
  data: GsEventStats | null | undefined,
  options: { stats?: string | undefined; limit?: number | undefined } = {},
): MatchStatRow[] {
  if (!data?.available || data.teams.length < 2) return [];
  const home = data.teams.find((t) => t.team.side === 'home') ?? data.teams[0]!;
  const away = data.teams.find((t) => t.team.side === 'away') ?? data.teams[1]!;
  const picked = (options.stats ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let keys: string[];
  if (picked.length) keys = [...new Set(picked)];
  else {
    const present = [...home.statistics, ...away.statistics].map(statKey).filter((k): k is string => !!k);
    const extra = [...new Set(present)].filter((k) => !MATCH_STATS_DEFAULT_ORDER.includes(k));
    keys = [...MATCH_STATS_DEFAULT_ORDER, ...extra];
  }
  const rows: MatchStatRow[] = [];
  for (const key of keys) {
    const h = home.statistics.find((s) => statKey(s) === key);
    const a = away.statistics.find((s) => statKey(s) === key);
    if (!h && !a) continue;
    // a api-sports manda null para zero nas contagens (ex.: cartões vermelhos)
    const zero = NOT_COUNTS.has(key) || !(h ?? a)!.code ? null : 0;
    const hv = numberOf(h) ?? zero;
    const av = numberOf(a) ?? zero;
    if (hv === null && av === null) continue;
    let best: MatchStatRow['best'] = null;
    if (hv !== null && av !== null && hv !== av)
      best = hv > av !== LOWER_IS_BETTER.has(key) ? 'home' : 'away';
    const total = (hv ?? 0) + (av ?? 0);
    const source = (h ?? a)!;
    rows.push({
      key,
      label: source.label ?? source.type ?? key,
      home: hv,
      away: av,
      best,
      share: hv !== null && av !== null && total > 0 ? hv / total : null,
      percent: PERCENT.has(key) || (typeof source.value === 'string' && source.value.endsWith('%')),
    });
  }
  const max = Math.max(0, Math.round(options.limit ?? 8) || 0);
  return max ? rows.slice(0, max) : rows;
}

/**
 * Estatísticas da partida em barras lado a lado (posse, finalizações, escanteios, faltas…), de
 * `/v1/events/{id}/stats`. Escolha das estatísticas e da ordem nas opções; sem estatística, estado vazio.
 */
export function MatchStats({
  eventId,
  stats,
  limit = 8,
  showTeams = true,
  showBars = true,
  highlightBest = true,
}: MatchStatsProps) {
  const { texts, locale, market } = useGalaxieWidget();
  const nf = new Intl.NumberFormat(intlLocale(locale, market), { maximumFractionDigits: 2 });
  const t = texts.matchStats;
  const enc = encodeURIComponent;
  const event = useGalaxieQuery<GsEvent>(eventId ? `/v1/events/${enc(eventId)}` : null, {}, (e) =>
    eventRefreshMs(e),
  );
  const started = event.data ? STARTED_STATUSES.has(event.data.status) : false;
  const query = useGalaxieQuery<GsEventStats>(started ? `/v1/events/${enc(eventId)}/stats` : null, {}, () =>
    event.data ? eventRefreshMs(event.data) : null,
  );

  if (!event.data) {
    return (
      <WidgetFrame kind="match_stats" busy={event.loading}>
        <h3 className="gs-title">{t.title}</h3>
        {event.loading ? (
          <LoadingState lines={5} />
        ) : (
          <ErrorState error={event.error} onRetry={event.retry} />
        )}
      </WidgetFrame>
    );
  }

  const { home, away } = sidesOf(event.data);
  const rows = matchStatRows(query.data, { stats, limit });
  const number = (row: MatchStatRow, v: number | null) =>
    v === null ? '–' : `${nf.format(v)}${row.percent ? '%' : ''}`;

  return (
    <WidgetFrame kind="match_stats" busy={query.loading && !query.data}>
      <header className="gs-header">
        <h3 className="gs-title">{t.title}</h3>
        <span className="gs-spacer" />
        <StatusBadge event={event.data} />
      </header>
      {showTeams && home && away ? (
        <div className="gs-mstats-teams">
          <span className="gs-mstats-team">
            <Crest src={home.logo} name={home.name} size="sm" />
            <span className="gs-truncate">{home.short_name ?? home.name}</span>
          </span>
          <span className="gs-mstats-team" data-side="away">
            <span className="gs-truncate">{away.short_name ?? away.name}</span>
            <Crest src={away.logo} name={away.name} size="sm" />
          </span>
        </div>
      ) : null}
      {!started ? (
        <EmptyState>{t.notStarted}</EmptyState>
      ) : query.loading && !query.data ? (
        <LoadingState lines={5} />
      ) : query.error && !query.data ? (
        <ErrorState error={query.error} onRetry={query.retry} />
      ) : rows.length === 0 ? (
        <EmptyState>{t.empty}</EmptyState>
      ) : (
        <ul className="gs-mstats">
          {rows.map((row) => (
            <li key={row.key} className="gs-mstat">
              <div className="gs-statrow">
                <span data-best={highlightBest && row.best === 'home' ? '' : undefined}>
                  {number(row, row.home)}
                </span>
                <span>{row.label}</span>
                <span data-best={highlightBest && row.best === 'away' ? '' : undefined}>
                  {number(row, row.away)}
                </span>
              </div>
              {showBars ? (
                <div className="gs-bar" aria-hidden="true">
                  {row.share === null ? null : (
                    <>
                      <span data-part="home" style={{ width: `${row.share * 100}%` }} />
                      <span data-part="away" style={{ width: `${(1 - row.share) * 100}%` }} />
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
