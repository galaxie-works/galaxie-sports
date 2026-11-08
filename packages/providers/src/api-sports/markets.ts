/**
 * Palpites (`/predictions?fixture=`) e odds pré-jogo (`/odds?fixture=`, nos outros esportes `/odds?game=`) da
 * api-sports, na nossa organização (docs/04 §2.4): o jogo, os times e as casas pelos IDs do fornecedor (o gravador
 * resolve pelo `provider_map`), percentuais e odds como números, mercados e seleções com chaves nossas.
 *
 * O dado fica inteiro: mercado sem chave nossa entra com `key: null` e o nome do fornecedor; o texto livre do
 * palpite (`advice`, `comment`) é guardado como veio, mas a API não o expõe (está em inglês e é do fornecedor).
 */

/** Lado e linha de gols ("-2.5" do fornecedor = menos de 2,5; "+1.5" = mais de 1,5). */
export interface PredictionGoalsLine {
  side: 'over' | 'under';
  line: number;
}

export type PredictionComparisonKey = 'form' | 'attack' | 'defense' | 'poisson' | 'h2h' | 'goals' | 'total';

export interface PredictionRecentForm {
  form: number | null;
  attack: number | null;
  defense: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalsForAverage: number | null;
  goalsAgainstAverage: number | null;
}

export interface NormalizedPrediction {
  /** ID do jogo no fornecedor (o `fixture` da requisição: a resposta não traz o jogo). */
  eventId: string;
  /** ID do time no fornecedor. */
  winnerTeamId: string | null;
  winOrDraw: boolean | null;
  probHome: number | null;
  probDraw: number | null;
  probAway: number | null;
  goals: { total?: PredictionGoalsLine; home?: PredictionGoalsLine; away?: PredictionGoalsLine } | null;
  comparison: Partial<Record<PredictionComparisonKey, { home: number | null; away: number | null }>> | null;
  recentForm: { home?: PredictionRecentForm; away?: PredictionRecentForm } | null;
  advice: string | null;
  winnerComment: string | null;
}

export type OddsMarketKey =
  | 'match_winner'
  | 'double_chance'
  | 'draw_no_bet'
  | 'both_teams_score'
  | 'goals_over_under'
  | 'first_half_winner'
  | 'second_half_winner'
  | 'exact_score'
  | 'asian_handicap'
  | 'handicap_result'
  | 'goals_over_under_first_half'
  | 'home_total_goals'
  | 'away_total_goals';

export interface OddsSelection {
  key: string;
  line: number | null;
  price: number;
}

export interface OddsMarket {
  key: OddsMarketKey | null;
  providerBet: { id: number | null; name: string };
  selections: OddsSelection[];
}

export interface NormalizedBookmakerOdds {
  /** ID da casa no fornecedor. */
  bookmakerId: string;
  bookmakerName: string;
  markets: OddsMarket[];
}

export interface NormalizedOdds {
  /** ID do jogo no fornecedor. */
  eventId: string;
  sourceUpdatedAt: Date | null;
  bookmakers: NormalizedBookmakerOdds[];
}

export interface MarketsBatch {
  provider: 'api-sports';
  sport: string;
  observedAt: Date;
  predictions: NormalizedPrediction[];
  odds: NormalizedOdds[];
  /** Casas citadas (das odds e de `/odds/bookmakers`). */
  bookmakers: { id: string; name: string }[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const idOf = (v: unknown): string | null =>
  typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? String(v) : null;

/** "45%" → 45; "33.3%" → 33.3; vazio ou inválido → null. */
export function percent(v: unknown): number | null {
  const s = text(v);
  if (!s) return null;
  const n = Number(s.replace('%', '').trim());
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

const number = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "-3.5" → menos de 3,5; "+1.5" ou "1.5" → mais de 1,5. */
export function goalsLine(v: unknown): PredictionGoalsLine | null {
  const s = text(v);
  const m = s?.match(/^([+-]?)\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { side: m[1] === '-' ? 'under' : 'over', line: Number(m[2]) };
}

const COMPARISON_KEYS: [string, PredictionComparisonKey][] = [
  ['form', 'form'],
  ['att', 'attack'],
  ['def', 'defense'],
  ['poisson_distribution', 'poisson'],
  ['h2h', 'h2h'],
  ['goals', 'goals'],
  ['total', 'total'],
];

function recentForm(team: Obj): PredictionRecentForm | undefined {
  const l5 = obj(team.last_5);
  if (!Object.keys(l5).length) return undefined;
  const goals = obj(l5.goals);
  const gf = obj(goals.for);
  const ga = obj(goals.against);
  const out: PredictionRecentForm = {
    form: percent(l5.form),
    attack: percent(l5.att),
    defense: percent(l5.def),
    goalsFor: number(gf.total),
    goalsAgainst: number(ga.total),
    goalsForAverage: number(gf.average),
    goalsAgainstAverage: number(ga.average),
  };
  return Object.values(out).some((v) => v != null) ? out : undefined;
}

/** `/predictions?fixture=`: um item por jogo. Sem o `fixture` da requisição, não há a que ligar. */
export function normalizePredictions(
  response: unknown[],
  observedAt: Date,
  params: Record<string, string> = {},
): MarketsBatch {
  const batch = emptyMarketsBatch('football', observedAt);
  const eventId = idOf(params.fixture);
  const item = obj(response[0]);
  if (!eventId || !Object.keys(item).length) return batch;
  const p = obj(item.predictions);
  const winner = obj(p.winner);
  const pct = obj(p.percent);
  const goals = obj(p.goals);
  const goalLines: NonNullable<NormalizedPrediction['goals']> = {};
  const total = goalsLine(p.under_over);
  const home = goalsLine(goals.home);
  const away = goalsLine(goals.away);
  if (total) goalLines.total = total;
  if (home) goalLines.home = home;
  if (away) goalLines.away = away;
  const cmp = obj(item.comparison);
  const comparison: NonNullable<NormalizedPrediction['comparison']> = {};
  for (const [from, to] of COMPARISON_KEYS) {
    const c = obj(cmp[from]);
    const h = percent(c.home);
    const a = percent(c.away);
    if (h != null || a != null) comparison[to] = { home: h, away: a };
  }
  const teams = obj(item.teams);
  const form: NonNullable<NormalizedPrediction['recentForm']> = {};
  const fh = recentForm(obj(teams.home));
  const fa = recentForm(obj(teams.away));
  if (fh) form.home = fh;
  if (fa) form.away = fa;
  batch.predictions.push({
    eventId,
    winnerTeamId: idOf(winner.id),
    winOrDraw: typeof p.win_or_draw === 'boolean' ? p.win_or_draw : null,
    probHome: percent(pct.home),
    probDraw: percent(pct.draw),
    probAway: percent(pct.away),
    goals: Object.keys(goalLines).length ? goalLines : null,
    comparison: Object.keys(comparison).length ? comparison : null,
    recentForm: Object.keys(form).length ? form : null,
    advice: text(p.advice),
    winnerComment: text(winner.comment),
  });
  return batch;
}

/** Mercados com chave nossa, pelo nome do fornecedor (o ID do tipo de aposta muda entre as APIs de cada esporte). */
const FOOTBALL_MARKETS: Record<string, OddsMarketKey> = {
  'match winner': 'match_winner',
  'home/away': 'draw_no_bet',
  'double chance': 'double_chance',
  'both teams score': 'both_teams_score',
  'goals over/under': 'goals_over_under',
  'first half winner': 'first_half_winner',
  'second half winner': 'second_half_winner',
  'exact score': 'exact_score',
  'asian handicap': 'asian_handicap',
  'handicap result': 'handicap_result',
  'goals over/under first half': 'goals_over_under_first_half',
  'total - home': 'home_total_goals',
  'total - away': 'away_total_goals',
};
/** Nos outros esportes, só o vencedor (sem empate) tem chave nossa por enquanto. */
const OTHER_MARKETS: Record<string, OddsMarketKey> = { 'home/away': 'match_winner' };

export function marketKey(sport: string, name: string): OddsMarketKey | null {
  const k = name.trim().toLowerCase();
  return (sport === 'football' ? FOOTBALL_MARKETS : OTHER_MARKETS)[k] ?? null;
}

/**
 * Seleção na nossa chave: "Home" → home, "Home/Draw" → home_draw, "Over 2.5" → over com linha 2,5,
 * "Home -1" → home com linha -1, "Yes" → yes, "2:1" fica como está. O resto fica com o valor do fornecedor.
 */
export function selectionOf(value: unknown): { key: string; line: number | null } | null {
  const s = text(value);
  if (!s) return null;
  const low = s.toLowerCase();
  if (/^(home|draw|away|yes|no|odd|even)$/.test(low)) return { key: low, line: null };
  let m = low.match(/^(home|draw|away)\s*\/\s*(home|draw|away)$/);
  if (m) return { key: `${m[1]}_${m[2]}`, line: null };
  m = low.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/);
  if (m) return { key: m[1]!, line: Number(m[2]) };
  m = low.match(/^(home|draw|away)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (m) return { key: m[1]!, line: Number(m[2]) };
  m = s.match(/^(\d+)\s*[:-]\s*(\d+)$/);
  if (m) return { key: `${m[1]}:${m[2]}`, line: null };
  return { key: s, line: null };
}

function marketsOf(sport: string, bets: unknown[]): OddsMarket[] {
  const out: OddsMarket[] = [];
  for (const b of bets.map(obj)) {
    const name = text(b.name);
    if (!name) continue;
    const selections: OddsSelection[] = [];
    for (const v of list(b.values).map(obj)) {
      const sel = selectionOf(v.value);
      const price = number(v.odd);
      if (!sel || price == null || price <= 0) continue;
      selections.push({ ...sel, price });
    }
    if (!selections.length) continue;
    out.push({
      key: marketKey(sport, name),
      providerBet: { id: typeof b.id === 'number' ? b.id : number(b.id), name },
      selections,
    });
  }
  return out;
}

const dateOf = (v: unknown): Date | null => {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** `/odds?fixture=` (futebol) e `/odds?game=` (demais): um item por jogo, com as casas e os mercados de cada uma. */
export function normalizeOdds(sport: string, response: unknown[], observedAt: Date): MarketsBatch {
  const batch = emptyMarketsBatch(sport, observedAt);
  const seen = new Map<string, string>();
  for (const item of response.map(obj)) {
    const eventId = idOf(obj(item.fixture).id) ?? idOf(obj(item.game).id) ?? idOf(obj(item.fight).id);
    if (!eventId) continue;
    const bookmakers: NormalizedBookmakerOdds[] = [];
    for (const bk of list(item.bookmakers).map(obj)) {
      const id = idOf(bk.id);
      const name = text(bk.name);
      if (!id || !name) continue;
      const markets = marketsOf(sport, list(bk.bets));
      if (!markets.length) continue;
      seen.set(id, name);
      bookmakers.push({ bookmakerId: id, bookmakerName: name, markets });
    }
    batch.odds.push({ eventId, sourceUpdatedAt: dateOf(item.update), bookmakers });
  }
  batch.bookmakers = [...seen].map(([id, name]) => ({ id, name }));
  return batch;
}

/** `/odds/bookmakers`: a lista de casas (id e nome). */
export function normalizeBookmakers(sport: string, response: unknown[], observedAt: Date): MarketsBatch {
  const batch = emptyMarketsBatch(sport, observedAt);
  for (const b of response.map(obj)) {
    const id = idOf(b.id);
    const name = text(b.name);
    if (id && name) batch.bookmakers.push({ id, name });
  }
  return batch;
}

export function emptyMarketsBatch(sport: string, observedAt: Date): MarketsBatch {
  return { provider: 'api-sports', sport, observedAt, predictions: [], odds: [], bookmakers: [] };
}

/** Endpoints que viram palpite, odds ou casa de apostas. */
export const MARKETS_ENDPOINTS = ['/predictions', '/odds', '/odds/bookmakers'] as const;

/**
 * Normaliza um envelope de palpites/odds pelo endpoint; `null` para os outros. `items` é o tamanho da resposta,
 * para o chamador distinguir vazio de cheio (resposta vazia não apaga o último estado).
 */
export function normalizeMarketsEnvelope(
  sport: string,
  endpoint: string,
  envelope: { response: unknown },
  observedAt: Date,
  params: Record<string, string> = {},
): { batch: MarketsBatch; items: number } | null {
  const response = Array.isArray(envelope.response) ? envelope.response : [];
  const items = response.length;
  switch (endpoint) {
    case '/predictions':
      return sport === 'football'
        ? { batch: normalizePredictions(response, observedAt, params), items }
        : null;
    case '/odds':
      return { batch: normalizeOdds(sport, response, observedAt), items };
    case '/odds/bookmakers':
      return { batch: normalizeBookmakers(sport, response, observedAt), items };
    default:
      return null;
  }
}
