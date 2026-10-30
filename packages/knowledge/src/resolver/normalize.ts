/** Normalização de nomes de clubes para o casamento slug ↔ api-sports (issue #17). */

/** Letras sem decomposição em base + acento: viram a grafia ASCII de costume ("Araklıspor", "Blau-Weiß"). */
const FOLD: Record<string, string> = {
  ı: 'i',
  ß: 'ss',
  œ: 'oe',
  æ: 'ae',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  þ: 'th',
  ð: 'd',
};

/** Minúsculas, sem acentos, só letras/dígitos separados por espaço. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ıßœæøłđþð]/g, (c) => FOLD[c]!)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Prefixos/sufixos societários e preposições que não distinguem clubes ("SC", "FC", "EC", "Clube", "de"...). */
const STOPWORDS = new Set([
  'fc',
  'sc',
  'ec',
  'ac',
  'afc',
  'cfc',
  'cf',
  'cd',
  'ca',
  'se',
  'sd',
  'cr',
  'cs',
  'ss',
  'ssc',
  'us',
  'as',
  'fk',
  'sk',
  'sv',
  'club',
  'clube',
  'futebol',
  'futbol',
  'football',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'del',
  'la',
  'el',
  'e',
  'y',
  'the',
  'of',
  'and',
]);

/** Tokens que distinguem o clube (sem stopwords). */
export function coreTokens(s: string): string[] {
  return normalizeName(s)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Equipes de base, femininas ou B ("Palmeiras U20", "Botafogo W", "Fortaleza B") — nunca são o time principal. */
export function isSecondaryTeam(name: string): boolean {
  const tokens = normalizeName(name).split(' ');
  return tokens.some(
    (t, i) =>
      /^(u|sub)\d{2}$/.test(t) ||
      ['women', 'fem', 'feminino', 'femenino', 'femenil', 'reserves', 'reserve', 'youth', 'ii'].includes(t) ||
      (i > 0 && i === tokens.length - 1 && (t === 'w' || t === 'b')),
  );
}

/** Unidades federativas do Brasil — aparecem como sufixo nos nomes da api-sports ("America-RN", "Botafogo PB"). */
export const BR_STATES = new Set([
  'ac',
  'al',
  'ap',
  'am',
  'ba',
  'ce',
  'df',
  'es',
  'go',
  'ma',
  'mt',
  'ms',
  'mg',
  'pa',
  'pb',
  'pr',
  'pe',
  'pi',
  'rj',
  'rn',
  'rs',
  'ro',
  'rr',
  'sc',
  'sp',
  'se',
  'to',
]);

/** Sufixo de estado no fim do nome (ex.: "Chapecoense-sc" → "sc"), ou null. */
export function stateSuffix(name: string): string | null {
  const tokens = normalizeName(name).split(' ');
  const last = tokens[tokens.length - 1];
  return tokens.length > 1 && last && BR_STATES.has(last) ? last : null;
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Coeficiente de Dice sobre bigramas de caracteres (0–1). */
export function bigramDice(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/**
 * Similaridade entre dois nomes de clube (0–1).
 * 1 = idênticos após normalização; 0,97 = iguais sem stopwords ("Fortaleza EC" × "Fortaleza");
 * um contido no outro ("Nautico" × "Nautico Recife") ≈ 0,85; senão Dice de tokens/bigramas × 0,9.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = coreTokens(a);
  const tb = coreTokens(b);
  const ja = ta.join(' ');
  const jb = tb.join(' ');
  if (ja && ja === jb) return 0.97;
  const sa = new Set(ta);
  const sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const tokenDice = sa.size + sb.size ? (2 * inter) / (sa.size + sb.size) : 0;
  let score = Math.max(tokenDice, bigramDice(ja.replace(/ /g, ''), jb.replace(/ /g, ''))) * 0.9;
  if (inter > 0 && inter === Math.min(sa.size, sb.size))
    score = Math.max(score, 0.85 - 0.05 * (Math.abs(sa.size - sb.size) - 1));
  return Math.min(1, score);
}
