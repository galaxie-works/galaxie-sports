import { sql, type SQL } from 'drizzle-orm';
import type { SearchMatch } from '@galaxie/contracts';

/**
 * Casamento da busca global (docs/05 §3.6): sem caixa nem acento, em três níveis — nome inteiro,
 * começo do nome ou de uma palavra dele, trecho. O SQL pré-seleciona os candidatos com a mesma
 * dobra (`foldSql`) e o JS decide o nível e qual apelido casou (`bestMatch`).
 */

// Pares acentuado → sem acento, nas duas caixas: a dobra não depende da collation do banco.
const ACCENTED = 'áàâãäåāéèêëēíìîïīóòôõöøōúùûüūçñýÁÀÂÃÄÅĀÉÈÊËĒÍÌÎÏĪÓÒÔÕÖØŌÚÙÛÜŪÇÑÝ';
const PLAIN = 'aaaaaaaeeeeeiiiiiooooooouuuuucnyAAAAAAAEEEEEIIIIIOOOOOOOUUUUUCNY';

/** Texto sem acento e em minúsculas (mesma regra do `foldSql`). */
export function fold(value: string): string {
  let out = '';
  for (const ch of value) {
    const i = ACCENTED.indexOf(ch);
    out += i >= 0 ? PLAIN[i] : ch;
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Classe de regex de cada letra com as variantes acentuadas, nas duas caixas: `a` → `[aAáàâ…]`.
const CLASSES = new Map<string, string>();
for (let i = 0; i < ACCENTED.length; i++) {
  const plain = PLAIN[i]!.toLowerCase();
  CLASSES.set(plain, (CLASSES.get(plain) ?? plain + plain.toUpperCase()) + ACCENTED[i]);
}

/**
 * Regex (`~*` do Postgres) que acha o termo já dobrado em texto com ou sem acento: "sao paulo" casa
 * "São Paulo". Bem mais barato que dobrar cada linha com `translate` antes do `like`.
 */
export function accentPattern(term: string): string {
  return [...term]
    .map((ch) => {
      const cls = CLASSES.get(ch);
      return cls ? `[${cls}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
}

/** `fold` no Postgres (sem a extensão unaccent). */
export function foldSql(expr: SQL): SQL {
  return sql`lower(translate(${expr}, ${ACCENTED}, ${PLAIN}))`;
}

const LEVEL: Record<SearchMatch, number> = { exact: 0, prefix: 1, contains: 2 };
export const matchRank = (m: SearchMatch) => LEVEL[m];

/** Nível do casamento de `term` (já dobrado) com `value`; null quando não casa. */
export function matchOf(value: string, term: string): SearchMatch | null {
  const v = fold(value);
  if (!v || !term) return null;
  if (v === term) return 'exact';
  if (v.startsWith(term) || v.includes(` ${term}`) || v.includes(`-${term}`)) return 'prefix';
  return v.includes(term) ? 'contains' : null;
}

/**
 * Melhor casamento entre o nome e os apelidos. O nome vence no empate; `matched` é o apelido só
 * quando ele casou melhor que o nome.
 */
export function bestMatch(
  name: string,
  aliases: readonly (string | null | undefined)[],
  term: string,
): { match: SearchMatch; matched: string | null } | null {
  const own = matchOf(name, term);
  let best: { match: SearchMatch; matched: string | null } | null = own
    ? { match: own, matched: null }
    : null;
  const seen = new Set([fold(name)]);
  for (const alias of aliases) {
    if (!alias) continue;
    const key = fold(alias);
    if (seen.has(key)) continue;
    seen.add(key);
    const m = matchOf(alias, term);
    if (m && (!best || LEVEL[m] < LEVEL[best.match])) best = { match: m, matched: alias };
  }
  return best;
}

/** Strings de um JSON qualquer (arrays de apelidos, objetos por locale, nomes anteriores…). */
export function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

/** `like` de um termo já dobrado: escapa os curingas. */
export const likeTerm = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);
