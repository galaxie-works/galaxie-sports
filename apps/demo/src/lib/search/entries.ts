/**
 * Entradas da busca global (⌘K): o que cada resultado mostra e para onde leva. Módulo puro, usado pela
 * paleta no navegador e pelos testes.
 */
import { foldSearchText, type SearchResult, type SearchType } from '@galaxie/contracts';

import type { DocGuideRef } from '../docs';

/** Operação da referência, só o que a busca precisa (vem do servidor: o OpenAPI não vai ao navegador). */
export interface ApiOperationSummary {
  method: string;
  route: string;
  summary: string;
  tag: string;
  anchor: string;
}

export type EntryKind = SearchType | 'doc' | 'section' | 'endpoint' | 'action';

/** Um item da paleta, serializável (é o que fica nos recentes). */
export interface SearchEntry {
  /** Único na paleta (`team:<id>`, `doc:/docs`…). */
  key: string;
  kind: EntryKind;
  href: string;
  label: string;
  detail: string | null;
  image: string | null;
  sport: string | null;
  /** Apelido ou nome anterior que casou. */
  matched?: string | null;
  /** Link de topo (sidebar): a trilha de navegação recomeça nele. */
  topLevel?: boolean;
  /** Jogo: início (ISO), ao vivo e os escudos. */
  event?: {
    startsAt: string;
    live: boolean;
    /** Jogo provisório: anunciado, ainda sem o fornecedor (a data vale; o horário pode não valer). */
    provisional: boolean;
    crests: { name: string; logo: string | null }[];
  };
  /** Endpoint: método HTTP. */
  method?: string;
}

/** Página da demo de um resultado da API. */
export function resultHref(r: Pick<SearchResult, 'type' | 'id' | 'slug'>): string {
  switch (r.type) {
    case 'team':
      return `/times/${r.id}`;
    case 'competition':
      return `/competicoes/${r.slug ?? r.id}`;
    case 'event':
      return `/eventos/${r.id}`;
    case 'person':
      return `/pessoas/${r.id}`;
    case 'venue':
      return `/locais/${r.id}`;
    case 'country':
      return `/paises/${r.id.toLowerCase()}`;
  }
}

export function resultEntry(r: SearchResult): SearchEntry {
  return {
    key: `${r.type}:${r.id}`,
    kind: r.type,
    href: resultHref(r),
    label: r.name,
    detail: r.detail,
    image: r.image,
    sport: r.sport,
    matched: r.matched,
    ...(r.event
      ? {
          event: {
            startsAt: r.event.starts_at,
            live: r.event.live,
            provisional: r.event.provisional,
            crests: r.event.participants.map((p) => ({ name: p.name, logo: p.logo })),
          },
        }
      : {}),
  };
}

/**
 * Ordem dos grupos no empate: o catálogo esportivo antes do resto, com as competições primeiro (são
 * poucas e levam a muitas páginas: "liber" mostra a Libertadores antes do Libertad e do Liberec).
 */
const GROUP_ORDER: SearchType[] = ['competition', 'team', 'event', 'country', 'person', 'venue'];
const MATCH_LEVEL = { exact: 0, prefix: 1, contains: 2 } as const;
/** Pessoas e estádios descem um nível: "boca" mostra o Boca Juniors antes de um jogador chamado Boca. */
const SECONDARY = new Set<SearchType>(['person', 'venue']);

/**
 * Resultados agrupados por tipo. Dentro do grupo, a ordem da API; os grupos, pelo melhor casamento de
 * cada um (pessoas e estádios com um nível a menos) e, no empate, pela `GROUP_ORDER`.
 */
export function groupResults(results: SearchResult[]): [SearchType, SearchEntry[]][] {
  const groups = new Map<SearchType, { best: number; entries: SearchEntry[] }>();
  for (const r of results) {
    const level = MATCH_LEVEL[r.match] + (SECONDARY.has(r.type) ? 1 : 0);
    const g = groups.get(r.type) ?? { best: Infinity, entries: [] };
    groups.set(r.type, { best: Math.min(g.best, level), entries: [...g.entries, resultEntry(r)] });
  }
  return [...groups]
    .sort(([ta, a], [tb, b]) => a.best - b.best || GROUP_ORDER.indexOf(ta) - GROUP_ORDER.indexOf(tb))
    .map(([type, g]) => [type, g.entries]);
}

/** Páginas, seções dos guias e endpoints da referência, como entradas da paleta (textos já no idioma). */
export function docsEntries(guides: DocGuideRef[], operations: ApiOperationSummary[]): SearchEntry[] {
  const reference = guides.find((d) => d.id === 'reference');
  return [
    ...guides.map<SearchEntry>((d) => ({
      key: `doc:${d.href}`,
      kind: 'doc',
      href: d.href,
      label: d.label,
      detail: d.description,
      image: null,
      sport: null,
      topLevel: true,
    })),
    ...guides.flatMap((d) =>
      d.sections.map<SearchEntry>((s) => ({
        key: `section:${d.href}#${s.id}`,
        kind: 'section',
        href: `${d.href}#${s.id}`,
        label: s.title,
        detail: d.label,
        image: null,
        sport: null,
      })),
    ),
    ...operations.map<SearchEntry>((o) => ({
      key: `endpoint:${o.anchor}`,
      kind: 'endpoint',
      href: `${reference?.href ?? '/docs/referencia'}#${o.anchor}`,
      label: o.route,
      detail: `${o.tag} · ${o.summary}`,
      image: null,
      sport: null,
      method: o.method,
    })),
  ];
}

/**
 * Filtro local (documentação e ações), com a mesma dobra da API: começo do rótulo, começo de uma
 * palavra e trecho, nessa ordem. Termo vazio devolve tudo.
 */
export function filterEntries(entries: SearchEntry[], query: string, limit = Infinity): SearchEntry[] {
  const term = foldSearchText(query);
  if (!term) return entries.slice(0, limit);
  const scored: { e: SearchEntry; score: number; i: number }[] = [];
  entries.forEach((e, i) => {
    const label = foldSearchText(e.label);
    const detail = foldSearchText(e.detail ?? '');
    let score = -1;
    if (label.startsWith(term)) score = 0;
    else if (label.includes(` ${term}`) || label.includes(`/${term}`)) score = 1;
    else if (label.includes(term)) score = 2;
    else if (detail.includes(term)) score = 3;
    if (score >= 0) scored.push({ e, score, i });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.e);
}
