import { createHash } from 'node:crypto';
import type { KnowledgeBase, LocatedGlossaryTerm } from './load.js';
import type { ReviewStatus } from './types.js';

/**
 * Revisão editorial da base pelo painel (Ajustes → Revisão semântica). Desenho em docs/06 §2.1:
 *
 * - O YAML continua sendo a fonte do **conteúdo**; o status de revisão passa a ter uma segunda fonte,
 *   `semantic.review_decision`, gravada pelo painel e nunca tocada pelo seed.
 * - Cada decisão guarda o `review_hash` do conteúdo que foi revisado. Enquanto o YAML tiver o mesmo
 *   conteúdo, a decisão vale (inclusive no próximo deploy, mesmo com o YAML ainda dizendo `draft`).
 *   Se o conteúdo mudar, a decisão fica "desatualizada" e volta a valer o status do YAML: aprovar um
 *   texto nunca aprova outro.
 * - O seed monta o catálogo `semantic.review_item` (tudo o que pode ser revisado, com o conteúdo legível)
 *   e aplica as decisões válidas nas tabelas servidas pela API.
 */

export const REVIEW_KINDS = [
  'team',
  'derby',
  'all-time',
  'competition',
  'copy',
  'glossary',
  'translation',
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/** Item revisável da base, como vai para `semantic.review_item`. */
export interface ReviewItem {
  /** `<tipo>:<chave>` (ex.: `team:palmeiras`, `copy:pt-BR.cheer-3`, `translation:team:palmeiras:es`). */
  id: string;
  kind: ReviewKind;
  /** Slug (time, clássico, competição), chave do template/termo (`<locale>.<key>`) ou slug do item traduzido. */
  key: string;
  /** Locale do texto: o da tradução, do template/termo ou o idioma-base do perfil; null nas competições. */
  locale: string | null;
  sport: string;
  /** País/mercado (ISO2 em maiúsculas, `INT` para clássico entre países); null quando não se aplica. */
  market: string | null;
  /** Nome curto para a lista. */
  title: string;
  sourceFile: string;
  /** Status escrito no YAML. */
  yamlStatus: ReviewStatus;
  /** sha256 do conteúdo revisável (sem o review_status). */
  reviewHash: string;
  /** Conteúdo legível do item (o próprio item do YAML, sem o review_status). */
  content: Record<string, unknown>;
  /** Traduções: os campos do original, no idioma-base. */
  original: Record<string, unknown> | null;
  originalLocale: string | null;
  /** Traduções: tipo do item traduzido (`team` ou `derby`). */
  parentKind: 'team' | 'derby' | null;
}

/** Decisão do painel sobre um item (o que o seed e a API precisam dela). */
export interface ReviewDecisionRef {
  itemId: string;
  status: ReviewStatus;
  reviewHash: string;
}

/** JSON canônico (chaves ordenadas) para os hashes de conteúdo. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

export const sha256Json = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Conteúdo revisável de um item do YAML: tudo menos o status (e a chave de lista `slug`, se pedido). */
export function reviewContent(entry: object, omit: readonly string[] = []): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entry).filter(([k]) => k !== 'review_status' && !omit.includes(k)),
  );
}

export const reviewHash = (content: Record<string, unknown>) => sha256Json(content);

export const reviewItemId = (kind: ReviewKind, key: string, locale?: string | null) =>
  kind === 'translation' ? `translation:${key}:${locale}` : `${kind}:${key}`;

/** Mercado de um locale de copy/glossário/tradução (`es-AR` → AR, `pt-BR` → BR, `es` → null). */
export const marketOfLocale = (locale: string) => locale.split('-')[1]?.toUpperCase() ?? null;

const statusOf = (v: unknown): ReviewStatus => (v === 'approved' || v === 'reviewed' ? v : 'draft');

/** Todos os itens revisáveis da base carregada. */
export function buildReviewItems(kb: KnowledgeBase): ReviewItem[] {
  const items: ReviewItem[] = [];
  const teams = new Map(kb.teams.map((t) => [t.entry.slug, t]));
  const derbies = new Map(kb.derbies.map((d) => [d.entry.slug, d]));

  for (const t of kb.teams) {
    const content = reviewContent(t.entry);
    items.push({
      id: reviewItemId('team', t.entry.slug),
      kind: 'team',
      key: t.entry.slug,
      locale: t.textLocale,
      sport: t.sport,
      market: t.countryCode ? t.countryCode.toUpperCase() : null,
      title: t.entry.names?.short ?? t.entry.slug,
      sourceFile: `data/knowledge/${t.file}`,
      yamlStatus: statusOf(t.entry.review_status),
      reviewHash: reviewHash(content),
      content,
      original: null,
      originalLocale: null,
      parentKind: null,
    });
  }
  for (const d of kb.derbies) {
    // o histórico geral é revisado à parte (item `all-time`): o clássico não muda de hash por causa dele
    const content = reviewContent(d.entry, ['all_time']);
    const countries = [
      ...new Set(d.entry.teams.map((s) => teams.get(s)?.countryCode.toUpperCase()).filter(Boolean)),
    ];
    items.push({
      id: reviewItemId('derby', d.entry.slug),
      kind: 'derby',
      key: d.entry.slug,
      locale: d.textLocale,
      sport: d.sport,
      market: countries.length === 1 ? countries[0]! : 'INT',
      title: d.entry.name,
      sourceFile: `data/knowledge/${d.file}`,
      yamlStatus: statusOf(d.entry.review_status),
      reviewHash: reviewHash(content),
      content,
      original: null,
      originalLocale: null,
      parentKind: null,
    });
  }
  // histórico geral curado, um item por clássico (`derby:<slug>`) e por par da lista (`pair:<slug>`);
  // o status fica dentro do bloco all_time
  const allTimeOwners = [
    ...kb.derbies
      .filter((d) => d.entry.all_time)
      .map((d) => ({ key: `derby:${d.entry.slug}`, title: d.entry.name, pair: d.entry.teams, ...d })),
    ...kb.headToHead.map((p) => ({
      key: `pair:${p.entry.slug}`,
      title: p.entry.teams.map((s) => teams.get(s)?.entry.names?.short ?? s).join(' × '),
      pair: p.entry.teams,
      ...p,
    })),
  ];
  for (const o of allTimeOwners) {
    const { review_status: status, ...allTime } = o.entry.all_time!;
    const content = { teams: o.pair, all_time: allTime };
    const countries = [
      ...new Set(o.pair.map((s) => teams.get(s)?.countryCode.toUpperCase()).filter(Boolean)),
    ];
    items.push({
      id: reviewItemId('all-time', o.key),
      kind: 'all-time',
      key: o.key,
      locale: null,
      sport: o.sport,
      market: countries.length === 1 ? countries[0]! : 'INT',
      title: o.title,
      sourceFile: `data/knowledge/${o.file}`,
      yamlStatus: statusOf(status),
      reviewHash: reviewHash(content),
      content,
      original: null,
      originalLocale: null,
      parentKind: null,
    });
  }
  for (const c of kb.competitions) {
    const content = reviewContent(c.entry);
    items.push({
      id: reviewItemId('competition', c.entry.slug),
      kind: 'competition',
      key: c.entry.slug,
      locale: null,
      sport: 'football',
      market: null,
      title: c.entry.labels?.['pt-BR'] ?? c.entry.labels?.['es'] ?? c.entry.slug,
      sourceFile: `data/knowledge/${c.file}`,
      yamlStatus: statusOf(c.entry.review_status),
      reviewHash: reviewHash(content),
      content,
      original: null,
      originalLocale: null,
      parentKind: null,
    });
  }
  for (const t of kb.copyTemplates) {
    const content = reviewContent(t.entry);
    const key = `${t.locale}.${t.entry.key}`;
    items.push({
      id: reviewItemId('copy', key),
      kind: 'copy',
      key,
      locale: t.locale,
      sport: t.sport,
      market: marketOfLocale(t.locale),
      title: t.entry.template,
      sourceFile: `data/knowledge/${t.file}`,
      yamlStatus: statusOf(t.entry.review_status),
      reviewHash: reviewHash(content),
      content,
      original: null,
      originalLocale: null,
      parentKind: null,
    });
  }
  for (const g of kb.glossary) {
    const content = reviewContent(g.entry);
    const key = glossaryKey(g);
    items.push({
      id: reviewItemId('glossary', key),
      kind: 'glossary',
      key,
      locale: g.locale,
      sport: g.sport,
      market: marketOfLocale(g.locale),
      title: g.entry.term,
      sourceFile: `data/knowledge/${g.file}`,
      yamlStatus: statusOf(g.entry.review_status),
      reviewHash: reviewHash(content),
      content,
      original: null,
      originalLocale: null,
      parentKind: null,
    });
  }
  for (const x of kb.texts) {
    const parentKind = x.listKey === 'teams' ? 'team' : 'derby';
    const parent = parentKind === 'team' ? teams.get(x.entry.slug) : derbies.get(x.entry.slug);
    const content = reviewContent(x.entry, ['slug']);
    const fields = Object.keys(reviewContent(x.entry, ['slug', 'note']));
    const original = parent
      ? Object.fromEntries(
          fields.map((f) => [f, (parent.entry as unknown as Record<string, unknown>)[f] ?? null]),
        )
      : null;
    const key = `${parentKind}:${x.entry.slug}`;
    const parentTitle =
      parentKind === 'team'
        ? (teams.get(x.entry.slug)?.entry.names?.short ?? x.entry.slug)
        : (derbies.get(x.entry.slug)?.entry.name ?? x.entry.slug);
    items.push({
      id: reviewItemId('translation', key, x.locale),
      kind: 'translation',
      key,
      locale: x.locale,
      sport: parent?.sport ?? 'football',
      market: marketOfLocale(x.locale),
      title: parentTitle,
      sourceFile: `data/knowledge/${x.file}`,
      yamlStatus: statusOf(x.entry.review_status),
      reviewHash: reviewHash(content),
      content,
      original,
      originalLocale: parent?.textLocale ?? null,
      parentKind,
    });
  }
  return items;
}

/** Chave de um termo do glossário (`<locale>.<key>`), a mesma em review_item e na API. */
export const glossaryKey = (g: Pick<LocatedGlossaryTerm, 'locale' | 'entry'>) => `${g.locale}.${g.entry.key}`;

/**
 * Status que vale para um item: o da decisão do painel, se ela foi tomada sobre este mesmo conteúdo;
 * senão o do YAML. `stale` = havia decisão, mas o conteúdo mudou depois dela.
 */
export function effectiveReviewStatus(
  item: { yamlStatus: ReviewStatus; reviewHash: string },
  decision: Pick<ReviewDecisionRef, 'status' | 'reviewHash'> | undefined,
): { status: ReviewStatus; decided: boolean; stale: boolean } {
  if (!decision) return { status: item.yamlStatus, decided: false, stale: false };
  if (decision.reviewHash !== item.reviewHash)
    return { status: item.yamlStatus, decided: false, stale: true };
  return { status: decision.status, decided: true, stale: false };
}

/** Status efetivo por id de item (só os itens com decisão válida). */
export function decidedStatuses(
  items: Pick<ReviewItem, 'id' | 'yamlStatus' | 'reviewHash'>[],
  decisions: ReviewDecisionRef[],
): Map<string, ReviewStatus> {
  const byId = new Map(decisions.map((d) => [d.itemId, d]));
  const out = new Map<string, ReviewStatus>();
  for (const item of items) {
    const e = effectiveReviewStatus(item, byId.get(item.id));
    if (e.decided) out.set(item.id, e.status);
  }
  return out;
}

/**
 * Aplica as decisões do painel aos termos do glossário lidos do YAML (a API lê o glossário direto dos
 * arquivos, sem passar pelo seed). Termo com decisão válida ganha o status dela.
 */
export function applyGlossaryDecisions(
  terms: LocatedGlossaryTerm[],
  decisions: ReviewDecisionRef[],
): LocatedGlossaryTerm[] {
  if (!decisions.length) return terms;
  const byId = new Map(decisions.map((d) => [d.itemId, d]));
  return terms.map((t) => {
    const decision = byId.get(reviewItemId('glossary', glossaryKey(t)));
    if (!decision) return t;
    const e = effectiveReviewStatus(
      { yamlStatus: statusOf(t.entry.review_status), reviewHash: reviewHash(reviewContent(t.entry)) },
      decision,
    );
    return e.decided ? { ...t, entry: { ...t.entry, review_status: e.status } } : t;
  });
}
