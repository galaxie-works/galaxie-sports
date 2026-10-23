/**
 * Prévia do que a API passaria a servir se o item fosse aprovado: o pedaço da resposta do endpoint que
 * vem deste item, com os nomes de campo do contrato (`@galaxie/contracts`). Puro: o servidor e os
 * testes usam o mesmo cálculo.
 */
import type { CopySuggestion, Derby, GlossaryTerm, TeamSemantic } from '@galaxie/contracts';

import type { ReviewDetail } from './types';

export interface ReviewPreview {
  endpoint: string;
  body: Record<string, unknown>;
}

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});

function teamBody(c: Rec, locale: string | null, market: string | null) {
  const names = rec(c.names);
  const labels = rec(c.labels);
  const fans = rec(c.fans);
  const stadium = c.stadium ? rec(c.stadium) : null;
  const body = {
    slug: String(c.slug ?? ''),
    country: market ?? '',
    name: str(labels['pt-BR']) ?? str(names.short) ?? '',
    official_name: str(names.official) ?? '',
    short_name: str(names.short) ?? '',
    abbreviation: str(names.abbreviation),
    city: str(c.city),
    region: str(c.region),
    founded: str(c.founded),
    colors: list(c.colors),
    nicknames: list(c.nicknames),
    mascot: str(c.mascot),
    fans: { demonym: str(fans.demonym), group_nicknames: list(fans.group_nicknames) },
    rallying_cries: list(c.rallying_cries),
    stadium: stadium
      ? {
          name: str(stadium.name) ?? '',
          nicknames: list(stadium.nicknames),
          former_names: Array.isArray(stadium.former_names)
            ? (stadium.former_names as { name: string; until: string }[])
            : [],
          city: str(stadium.city),
        }
      : null,
    identity: list(c.identity),
    text_locale: (locale ?? 'pt-BR') as TeamSemantic['text_locale'],
  } satisfies Partial<Record<keyof TeamSemantic, unknown>>;
  return body;
}

function derbyBody(c: Rec, locale: string | null) {
  return {
    slug: String(c.slug ?? ''),
    name: str(c.name) ?? '',
    aliases: list(c.aliases),
    scope: c.scope as Derby['scope'],
    intensity: Number(c.intensity ?? 0),
    labels: rec(c.labels) as Derby['labels'],
    first_match: str(c.first_match),
    origin: str(c.origin),
    trivia: list(c.trivia),
    text_locale: (locale ?? 'pt-BR') as Derby['text_locale'],
    sources: list(c.sources),
    review_status: 'approved',
  } satisfies Partial<Record<keyof Derby, unknown>>;
}

export function previewFor(
  item: Pick<ReviewDetail, 'kind' | 'key' | 'locale' | 'market' | 'content' | 'parentKind'>,
): ReviewPreview {
  const c = item.content;
  switch (item.kind) {
    case 'team':
      return { endpoint: `GET /v1/teams/${item.key}/semantic`, body: teamBody(c, item.locale, item.market) };
    case 'derby':
      return { endpoint: `GET /v1/derbies/${item.key}`, body: derbyBody(c, item.locale) };
    case 'competition': {
      const labels = rec(c.labels);
      const nick = rec(c.nicknames);
      return {
        endpoint: `GET /v1/competitions/${item.key}`,
        body: {
          slug: item.key,
          name: str(labels['pt-BR']) ?? item.key,
          nicknames: list(nick['pt-BR']),
          trophy_nickname: str(c.trophy_nickname),
        },
      };
    }
    case 'copy': {
      const body = {
        key: item.key,
        template: str(c.template) ?? '',
        intent: c.intent as NonNullable<CopySuggestion['selection']>['intent'],
        tone: Number(c.tone ?? 1),
        confidence: c.confidence as NonNullable<CopySuggestion['selection']>['confidence'],
        review_status: 'approved' as const,
      } satisfies Partial<NonNullable<CopySuggestion['selection']>>;
      return { endpoint: `GET /v1/copy?locale=${item.locale}&intent=${String(c.intent)}`, body };
    }
    case 'glossary': {
      const body: GlossaryTerm = {
        key: String(c.key ?? ''),
        term: str(c.term) ?? '',
        meaning: str(c.meaning) ?? '',
        example: str(c.example),
        category: c.category as GlossaryTerm['category'],
        copy_intents: list(c.copy_intents) as GlossaryTerm['copy_intents'],
        requires: (str(c.requires) as GlossaryTerm['requires']) ?? null,
        note: str(c.note),
        sources: list(c.sources),
        review_status: 'approved',
      };
      return { endpoint: `GET /v1/glossary?locale=${item.locale}`, body };
    }
    case 'translation': {
      const slug = item.key.slice(item.key.indexOf(':') + 1);
      // a tradução troca, campo a campo, o texto do original no locale dela (docs/06 §3.3)
      const { review_status: _s, note: _n, ...fields } = c;
      const endpoint =
        item.parentKind === 'derby'
          ? `GET /v1/derbies/${slug}?locale=${item.locale}`
          : `GET /v1/teams/${slug}/semantic?locale=${item.locale}`;
      return { endpoint, body: { ...fields, text_locale: item.locale } };
    }
  }
}

/**
 * Converte o texto digitado no formulário de sugestão para o tipo do campo original: lista de textos
 * = uma linha por item; número = número; objeto = JSON; texto = texto. Devolve `undefined` quando o
 * valor não mudou e lança `SyntaxError` para JSON inválido.
 */
export function parseProposedField(original: unknown, typed: string): unknown {
  const raw = typed.trim();
  if (Array.isArray(original) && original.every((x) => typeof x === 'string')) {
    const next = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return JSON.stringify(next) === JSON.stringify(original) ? undefined : next;
  }
  if (typeof original === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new SyntaxError('number');
    return n === original ? undefined : n;
  }
  if (original !== null && typeof original === 'object') {
    const next: unknown = JSON.parse(raw);
    return JSON.stringify(next) === JSON.stringify(original) ? undefined : next;
  }
  const value = raw || null;
  return value === (original ?? null) ? undefined : value;
}

/** Texto inicial do campo no formulário (o inverso de `parseProposedField`). */
export function fieldText(value: unknown): string {
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) return value.join('\n');
  if (value !== null && typeof value === 'object') return JSON.stringify(value, null, 2);
  return value === null || value === undefined ? '' : String(value);
}
