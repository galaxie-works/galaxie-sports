/**
 * Revisão da base semântica (Ajustes → Revisão): tipos compartilhados entre o servidor e o navegador e
 * a leitura dos filtros da URL. Desenho da persistência em docs/06 §2.1.
 */

export const REVIEW_KINDS = [
  'team',
  'derby',
  'all-time',
  'competition',
  'copy',
  'glossary',
  'translation',
  'editorial',
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/**
 * Situação do item no painel. `needs_review` = há sugestão de edição em aberto; para a API ele é
 * `draft` (não é servido). Os demais são os status da base (`draft`, `reviewed`, `approved`).
 */
export const REVIEW_STATES = ['draft', 'needs_review', 'reviewed', 'approved'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_ACTIONS = ['approve', 'draft', 'suggest'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Escolhas de cada filtro; lista vazia = sem filtro (tudo). Mais de um valor = "é um destes". */
export interface ReviewFilters {
  kind: ReviewKind[];
  sport: string[];
  market: string[];
  locale: string[];
  state: ReviewState[];
  q: string | null;
  page: number;
  /** Itens por página (`?per=`), sempre um de `PAGE_SIZES`. */
  per: number;
}

/** Quantos itens a lista mostra por página (`?per=`); fora desta lista vale o padrão. */
export const PAGE_SIZES = [25, 50, 100, 250, 500] as const;
export const DEFAULT_PAGE_SIZE = 50;
/** Teto de `?per=` (e da ação em lote, que age sobre a seleção de uma página). */
export const MAX_PAGE_SIZE = PAGE_SIZES[PAGE_SIZES.length - 1];

/** Tamanho da página a partir da query string: só um dos `PAGE_SIZES`; o resto cai no padrão. */
export function parsePageSize(raw: string | null | undefined): number {
  const n = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

/** Limite e deslocamento da consulta para a página pedida. */
export const pageWindow = (filters: Pick<ReviewFilters, 'page' | 'per'>) => ({
  limit: filters.per,
  offset: (filters.page - 1) * filters.per,
});

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
  /** O conteúdo no ar tem uma edição gravada no banco (por cima do YAML). */
  edited: boolean;
}

/** Linha da lista: o item, o que revisar nele e a sugestão em aberto (comentário), se houver. */
export interface ReviewListRow extends ReviewListItem {
  summary: string;
  openSuggestion: string | null;
  /** Motivo da IA ao recusar a sugestão em aberto (o item segue "precisa de revisão"). */
  aiRejection: string | null;
  /** Achados do validador (perfil editorial da F1): o selo "N alertas / N graves"; null sem achados. */
  findings: { alert: number; severe: number } | null;
}

/** Linha da lista: o item, o que revisar nele e a sugestão em aberto (comentário), se houver. */
export interface ReviewListRow extends ReviewListItem {
  summary: string;
  openSuggestion: string | null;
}

export interface ReviewSuggestion {
  comment: string;
  fields: Record<string, unknown> | null;
}

/**
 * Veredito do agente de revisão de sugestões (job `review-suggestions`) sobre a última sugestão do
 * item. O mesmo formato de `semantic.review_decision.ai_verdict`.
 */
export interface ReviewAiVerdict {
  outcome: 'accepted' | 'adjusted' | 'rejected';
  reason: string;
  fields: Record<string, unknown> | null;
  adjustments: string[];
  validation: string[];
  /** Quem decidiu (o provedor do modelo: `gemini` em produção). */
  by: string;
  model: string;
  at: string;
}

/** Edição de conteúdo em vigor no banco, por cima do YAML (semantic.review_override). */
export interface ReviewOverride {
  /** Valor no ar, por campo (null = campo removido). */
  fields: Record<string, unknown>;
  /** Valor do YAML quando a edição foi feita. */
  base: Record<string, unknown>;
  source: string;
  reason: string | null;
  at: string;
}

/** Ações registradas na auditoria: as do painel e os vereditos do agente. */
export type ReviewLogAction = ReviewAction | 'ai_approve' | 'ai_reject';

export interface ReviewLogEntry {
  id: string;
  action: ReviewLogAction;
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
  /** Veredito da IA sobre a decisão vigente (recusa da sugestão em aberto ou aprovação dela). */
  aiVerdict: ReviewAiVerdict | null;
  override: ReviewOverride | null;
  log: ReviewLogEntry[];
}

export interface ReviewListResult {
  items: ReviewListRow[];
  total: number;
  /** Contagem por situação com os demais filtros aplicados (o filtro de situação não entra). */
  counts: Record<ReviewState, number>;
  options: { sports: string[]; markets: string[]; locales: string[] };
}

/** Até quantos valores cada filtro aceita (a URL é de quem chama: sem lista sem fim no SQL). */
const MAX_VALUES = 20;

/** Lista separada por vírgula, sem repetição e sem vazios. */
const splitList = (raw: string | null) => [
  ...new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

/** Texto livre de filtro: aparado, sem caracteres de controle, até `max` caracteres. */
const text = (value: string | null | undefined, max = 80) => {
  // eslint-disable-next-line no-control-regex
  const v = value?.replace(/[\u0000-\u001f]/g, '').trim();
  return v ? v.slice(0, max) : null;
};

/** Valores de uma lista livre (esporte, mercado, idioma), cada um limpo e curto. */
const texts = (raw: string | null, max: number) =>
  [...new Set(splitList(raw).map((v) => text(v, max)))].filter((v): v is string => !!v).slice(0, MAX_VALUES);

/** Só os valores conhecidos de uma lista fechada (tipo, status). */
const known = <T extends string>(list: readonly T[], raw: string | null): T[] =>
  splitList(raw).filter((v): v is T => (list as readonly string[]).includes(v));

/** Nome de cada filtro na URL (`?tipo=team,copy&esporte=football`). */
export const REVIEW_FILTER_PARAMS = {
  kind: 'tipo',
  sport: 'esporte',
  market: 'mercado',
  locale: 'locale',
  state: 'status',
  q: 'q',
  page: 'pagina',
  per: 'per',
} as const satisfies Record<keyof ReviewFilters, string>;

export const NO_REVIEW_FILTERS: ReviewFilters = {
  kind: [],
  sport: [],
  market: [],
  locale: [],
  state: [],
  q: null,
  page: 1,
  per: DEFAULT_PAGE_SIZE,
};

/** Filtros a partir da query string (valores desconhecidos são ignorados). */
export function parseFilters(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): ReviewFilters {
  const get = (k: string) => {
    if (params instanceof URLSearchParams) return params.get(k);
    const v = params[k];
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  };
  const P = REVIEW_FILTER_PARAMS;
  const page = Number.parseInt(get(P.page) ?? '', 10);
  return {
    kind: known(REVIEW_KINDS, get(P.kind)),
    sport: texts(get(P.sport), 40),
    market: [...new Set(texts(get(P.market), 8).map((m) => m.toUpperCase()))],
    locale: texts(get(P.locale), 8),
    state: known(REVIEW_STATES, get(P.state)),
    q: text(get(P.q)),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
    per: parsePageSize(get(P.per)),
  };
}

/** Query string dos filtros (só o que está definido), para links e paginação. */
export function filtersQuery(filters: Partial<ReviewFilters>): string {
  const P = REVIEW_FILTER_PARAMS;
  const q = new URLSearchParams();
  for (const field of ['kind', 'sport', 'market', 'locale', 'state'] as const) {
    const values = filters[field];
    if (values?.length) q.set(P[field], values.join(','));
  }
  if (filters.q) q.set(P.q, filters.q);
  if (filters.page && filters.page > 1) q.set(P.page, String(filters.page));
  if (filters.per && filters.per !== DEFAULT_PAGE_SIZE) q.set(P.per, String(filters.per));
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
