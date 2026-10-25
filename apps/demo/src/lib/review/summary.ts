/**
 * Resumo do que revisar num item (coluna "O que revisar" da lista): o texto que a pessoa precisa
 * conferir, sem abrir o detalhe. Puro: o servidor monta e os testes conferem o mesmo cálculo.
 */
import type { ReviewKind } from './types';

type Rec = Record<string, unknown>;

const SUMMARY_MAX = 600;

/** Palavras do resumo que dependem do idioma do painel (`{count}` = número). */
export interface SummaryWords {
  matches: string;
  draws: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((x): x is string => x !== null) : []);
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});

/** Valores de um objeto de rótulos/apelidos por idioma (`{ pt-BR: 'x', es: ['y'] }`), sem repetir. */
const byLocale = (v: unknown) =>
  [
    ...new Set(Object.values(rec(v)).flatMap((x) => (Array.isArray(x) ? list(x) : [str(x)].filter(Boolean)))),
  ] as string[];

/** Campos que não são texto a revisar (identificadores, fontes, metadados). */
const SKIP = new Set(['slug', 'key', 'sources', 'teams', 'confidence', 'intent', 'tone', 'scope', 'as_of']);

/** Todo texto de um conteúdo, na ordem dos campos (fallback dos tipos sem regra própria). */
function flatten(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (v.trim()) out.push(v.trim());
  } else if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Rec)) if (!SKIP.has(k)) flatten(x, out);
  }
  return out;
}

function allTime(c: Rec, words: SummaryWords) {
  const a = rec(c.all_time);
  const teams = (Array.isArray(a.teams) ? a.teams : []).map((t) => {
    const r = rec(t);
    return `${str(r.team) ?? '?'} ${Number(r.wins ?? 0)}`;
  });
  if (!teams.length) return flatten(c);
  return [
    `${words.matches.replace('{count}', String(Number(a.matches ?? 0)))}: ${teams.join(', ')}, ${words.draws.replace('{count}', String(Number(a.draws ?? 0)))}`,
    ...[str(a.basis), str(a.as_of)].filter((x): x is string => x !== null),
  ];
}

function parts(kind: ReviewKind, c: Rec, words: SummaryWords): string[] {
  switch (kind) {
    case 'glossary':
      return [[str(c.term), str(c.meaning)].filter(Boolean).join(': '), str(c.example), str(c.note)].filter(
        (x): x is string => !!x,
      );
    case 'copy':
      return [str(c.template)].filter((x): x is string => x !== null);
    case 'derby':
      return [str(c.name), ...list(c.aliases), str(c.origin), ...list(c.trivia)].filter(
        (x): x is string => x !== null,
      );
    case 'all-time':
      return allTime(c, words);
    case 'competition':
      return [...byLocale(c.labels), ...byLocale(c.nicknames)];
    case 'editorial': {
      // a bio primeiro, depois os momentos com o ano e a corrida (o que mais pede conferência)
      const moments = (Array.isArray(c.moments) ? c.moments : []).map((m) => {
        const r = rec(m);
        return `${String(r.year ?? '')} ${str(r.race) ?? ''}: ${str(r.text) ?? ''}`.trim();
      });
      return [str(rec(c.bio).text), str(rec(c.style).text), ...moments].filter((x): x is string => !!x);
    }
    case 'team': {
      const names = rec(c.names);
      return [
        str(names.official),
        ...list(c.nicknames),
        str(c.mascot),
        ...list(c.rallying_cries),
        ...list(c.identity),
      ].filter((x): x is string => x !== null);
    }
    default:
      return flatten(c);
  }
}

/** Texto do resumo: as partes separadas por " · ", sem repetir, cortado em SUMMARY_MAX caracteres. */
export function reviewSummary(
  kind: ReviewKind,
  content: Record<string, unknown> | null,
  words: SummaryWords,
): string {
  const text = [...new Set(parts(kind, rec(content), words))].join(' · ');
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
}
