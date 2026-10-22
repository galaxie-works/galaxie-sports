/**
 * Comparação de nomes de estádios e times (curadoria × fornecedor, histórico de nomes).
 * Puro, sem banco: usado pela API, pela base semântica e pela ingestão.
 */

/** Letras que o NFD não decompõe (turco, azeri, nórdicas, polonês...). */
const FOLD: Record<string, string> = {
  ı: 'i',
  ə: 'e',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  þ: 'th',
};

/** Entidades HTML que o fornecedor às vezes deixa no nome ("Inter&amp;Co Stadium"). */
export function decodeEntities(name: string): string {
  return name
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

/** Chave de comparação de nomes: sem caixa, acentos e pontuação ("Estádio X" = "estadio x"). */
export function nameKey(name: string): string {
  return decodeEntities(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ıəøæœßđðłþ]/gu, (c) => FOLD[c] ?? c)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Palavras genéricas que não distinguem um nome do outro (estádio em vários idiomas, siglas de clube). */
const NOISE = new Set(
  (
    'estadio stadium stadion stadions stadionul stade stadio estadi stadyumu stadyum stadionu stadiumi ' +
    'olimpico olimpica olympic municipal de do da dos das del the fc sc cf ac afc cd ca ec pfc sk fk ' +
    'club clube futbol football'
  ).split(' '),
);
/** Sufixo "estádio" colado ao nome ("Jan Breydelstadion"). */
const GLUED = /(stadion|stadium|stadyumu)$/;

function nameTokens(name: string, city: string | null | undefined): string[] {
  const cityTokens = new Set(city ? nameKey(city.split(',')[0]!).split(' ') : []);
  return nameKey(name.replace(/\([^)]*\)/g, ' '))
    .split(' ')
    .filter((t) => t && !NOISE.has(t) && !cityTokens.has(t) && !/^\d$/.test(t))
    .map((t) => (t.length > 8 ? t.replace(GLUED, '') : t));
}

/** Mesma palavra com duas letras vizinhas trocadas ("lsk" × "lks"). */
function oneTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  return (
    diff.length === 2 &&
    diff[1] === diff[0]! + 1 &&
    a[diff[0]!] === b[diff[1]!] &&
    a[diff[1]!] === b[diff[0]!]
  );
}

/**
 * Duas grafias do mesmo nome, e não uma troca de nome? Ignora caixa, acentos, pontuação, espaços,
 * palavras genéricas ("Estádio", "Olímpico", "FC"), a cidade, o trecho entre parênteses e uma troca
 * de letras vizinhas ("LSK-Hallen" × "LKS-Hallen"). Um nome contido no outro só conta com 2+ palavras.
 */
export function sameName(a: string, b: string, city?: string | null): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (ka === kb || ka.replace(/ /g, '') === kb.replace(/ /g, '') || oneTransposition(ka, kb)) return true;
  const ta = nameTokens(a, city);
  const tb = nameTokens(b, city);
  if (!ta.length || !tb.length) return false;
  if (ta.join('') === tb.join('')) return true;
  const [small, big] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return small.length >= 2 && small.every((t) => big.has(t));
}
