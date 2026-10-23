/**
 * Revisão da base semântica (Ajustes → Revisão): tipos compartilhados entre o servidor e o navegador e
 * a leitura dos filtros da URL. Desenho da persistência em docs/06 §2.1.
 */

export const REVIEW_KINDS = ['team', 'derby', 'competition', 'copy', 'glossary', 'translation'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/**
 * Situação do item no painel. `needs_review` = há sugestão de edição em aberto; para a API ele é
 * `draft` (não é servido). Os demais são os status da base (`draft`, `reviewed`, `approved`).
 */
export const REVIEW_STATES = ['draft', 'needs_review', 'reviewed', 'approved'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_ACTIONS = ['approve', 'draft', 'suggest'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export interface ReviewFilters {
  kind: ReviewKind | null;
  sport: string | null;
  market: string | null;
  locale: string | null;
  state: ReviewState | null;
  q: string | null;
  page: number;
}

export const PAGE_SIZE = 50;

export interface ReviewListItem {
  id: string;
  kind: ReviewKind;
  key: string;
  title: string;
  sport: string;
  market: string | null;
  locale: string | null;
  state: ReviewState;
  /** Houve decisão no painel, mas o YAML mudou depois dela (voltou a valer o status do YAML). */
  stale: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface ReviewSuggestion {
  comment: string;
  fields: Record<string, unknown> | null;
}

export interface ReviewLogEntry {
  id: string;
  action: ReviewAction;
  fromStatus: string | null;
  toStatus: string;
  comment: string | null;
  proposed: Record<string, unknown> | null;
  actor: string;
  createdAt: string;
}

export interface ReviewDetail extends ReviewListItem {
  sourceFile: string;
  yamlStatus: string;
  content: Record<string, unknown>;
  original: Record<string, unknown> | null;
  originalLocale: string | null;
  parentKind: 'team' | 'derby' | null;
  suggestion: ReviewSuggestion | null;
  log: ReviewLogEntry[];
}

export interface ReviewListResult {
  items: ReviewListItem[];
  total: number;
  /** Contagem por situação com os demais filtros aplicados (o filtro de situação não entra). */
  counts: Record<ReviewState, number>;
  options: { sports: string[]; markets: string[]; locales: string[] };
}

const pick = <T extends string>(list: readonly T[], value: string | null | undefined): T | null =>
  value && (list as readonly string[]).includes(value) ? (value as T) : null;

/** Texto livre de filtro: aparado, sem caracteres de controle, até 80 caracteres. */
const text = (value: string | null | undefined, max = 80) => {
  // eslint-disable-next-line no-control-regex
  const v = value?.replace(/[\u0000-\u001f]/g, '').trim();
  return v ? v.slice(0, max) : null;
};

/** Filtros a partir da query string (valores desconhecidos são ignorados). */
export function parseFilters(params: URLSearchParams | Record<string, string | string[] | undefined>) {
  const get = (k: string) => {
    if (params instanceof URLSearchParams) return params.get(k);
    const v = params[k];
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  };
  const page = Number.parseInt(get('pagina') ?? '', 10);
  return {
    kind: pick(REVIEW_KINDS, get('tipo')),
    sport: text(get('esporte'), 40),
    market: text(get('mercado'), 8)?.toUpperCase() ?? null,
    locale: text(get('locale'), 8),
    state: pick(REVIEW_STATES, get('status')),
    q: text(get('q')),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
  } satisfies ReviewFilters;
}

/** Query string dos filtros (só o que está definido), para links e paginação. */
export function filtersQuery(filters: Partial<ReviewFilters>): string {
  const q = new URLSearchParams();
  if (filters.kind) q.set('tipo', filters.kind);
  if (filters.sport) q.set('esporte', filters.sport);
  if (filters.market) q.set('mercado', filters.market);
  if (filters.locale) q.set('locale', filters.locale);
  if (filters.state) q.set('status', filters.state);
  if (filters.q) q.set('q', filters.q);
  if (filters.page && filters.page > 1) q.set('pagina', String(filters.page));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Segmento de URL de um item. O ponto vai codificado: `glossary:pt-BR.secar` terminaria em ".secar" e o
 * proxy trataria a página como arquivo estático (sem o segmento de idioma).
 */
export const itemSegment = (id: string) => encodeURIComponent(id).replace(/\./g, '%2E');

export const REVIEW_STATUSES = ['draft', 'reviewed', 'approved'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Piso editorial da API (SEMANTIC_MIN_REVIEW_STATUS), como ela relata em ops.runtime_env na partida. */
export interface ServingFloor {
  /** null = a API ainda não relatou (versão antiga ou nunca iniciou com este banco). */
  floor: ReviewStatus | null;
  reportedAt: string | null;
}

/** Status que a API enxerga para uma situação do painel (sugestão em aberto = rascunho). */
export const servedStatus = (state: ReviewState): ReviewStatus =>
  state === 'needs_review' ? 'draft' : state;

/**
 * A API serve o item com este piso? Ela serve tudo com status ≥ ao piso efetivo: o maior entre o do
 * servidor e o `?min_review_status=` do cliente (o cliente só endurece).
 */
export const servedAt = (state: ReviewState, floor: ReviewStatus) =>
  REVIEW_STATUSES.indexOf(servedStatus(state)) >= REVIEW_STATUSES.indexOf(floor);

/** Pisos que o cliente pode pedir com o piso do servidor (o dele e os mais rígidos). */
export const floorsFrom = (floor: ReviewStatus | null): readonly ReviewStatus[] =>
  REVIEW_STATUSES.slice(floor ? REVIEW_STATUSES.indexOf(floor) : 0);

/** Status servido pela API para cada ação do painel. */
export const STATUS_OF_ACTION: Record<ReviewAction, 'approved' | 'draft'> = {
  approve: 'approved',
  draft: 'draft',
  suggest: 'draft',
};
