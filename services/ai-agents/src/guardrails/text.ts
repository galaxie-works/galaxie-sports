/**
 * Utilitários de texto compartilhados pelos guardrails: normalização sem acentos, frases e
 * detecção de idioma (pt × es × en) por marcadores simples.
 */

/**
 * Locales com texto gerado: os 8 mercados (mesma lista de `@galaxie/rules` e `@galaxie/knowledge`) e o inglês
 * (`en`, o mesmo da API e dos rótulos fixos de `@galaxie/rules`): a tela e os widgets em inglês pedem `en`.
 */
export const AGENT_LOCALES = [
  'pt-BR',
  'es-AR',
  'es-MX',
  'es-CO',
  'es-CL',
  'es-PE',
  'es-UY',
  'es-EC',
  'en',
] as const;
export type AgentLocale = (typeof AGENT_LOCALES)[number];

export function isAgentLocale(value: string): value is AgentLocale {
  return (AGENT_LOCALES as readonly string[]).includes(value);
}

export type AgentLanguage = 'pt' | 'es' | 'en';

/** Idioma-base do locale. */
export function languageOf(locale: string): AgentLanguage {
  const l = locale.toLowerCase();
  if (l.startsWith('pt')) return 'pt';
  if (l === 'en' || l.startsWith('en-')) return 'en';
  return 'es';
}

/** Escolhe o texto do idioma do locale (`inLanguage(locale, { pt, es, en })`). */
export function inLanguage<T>(locale: string, byLanguage: Record<AgentLanguage, T>): T {
  return byLanguage[languageOf(locale)];
}

/** Minúsculas, sem diacríticos, aspas tipográficas trocadas e espaços colapsados. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras que abrem frase depois de uma sigla com pontos (artigos, pronomes, preposições e conectivos). */
const SENTENCE_OPENERS: ReadonlySet<string> = new Set(
  (
    'o a os as um uma el la los las un una the a an em no na com sem para por en con sin in on at with for to ' +
    'it its he she they this that ele ela eles elas el ese esa este esta mas pero but and e y depois antes ' +
    'despues after before agora ahora now ja ya still ainda todavia com con'
  ).split(/\s+/),
);

/** Divide em frases (ponto final, exclamação, interrogação ou ponto e vírgula seguido de espaço). */
export function splitSentences(text: string): string[] {
  // a inicial de um nome ("M. Hinestroza", "J. Rodríguez") não encerra a frase; a sigla com pontos
  // ("Estudiantes L.P.") só encerra quando a palavra seguinte abre frase ("… L.P. O jogo terminou.")
  const parts = text
    .split(/(?<=[.!?…])(?<!(?:^|[\s(])\p{Lu}\.)\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const prev = out.at(-1);
    const opener = normalizeText(/^\p{L}+/u.exec(part)?.[0] ?? '');
    if (prev && /\p{Lu}\.\p{Lu}\.$/u.test(prev) && !SENTENCE_OPENERS.has(opener))
      out[out.length - 1] = `${prev} ${part}`;
    else out.push(part);
  }
  return out;
}

/** Junta frases em um parágrafo, garantindo pontuação final em cada uma. */
export function joinSentences(sentences: readonly string[]): string {
  return sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[.!?…]$/u.test(s) ? s : `${s}.`))
    .join(' ');
}

/** Palavras funcionais exclusivas (ou quase) de cada idioma. */
const PT_WORDS = new Set([
  'não',
  'você',
  'é',
  'do',
  'da',
  'dos',
  'das',
  'pelo',
  'pela',
  'ao',
  'aos',
  'com',
  'em',
  'um',
  'uma',
  'na',
  'vitória',
  'gols',
  'jogo',
  'também',
  'então',
]);
const ES_WORDS = new Set([
  'el',
  'y',
  'del',
  'los',
  'es',
  'con',
  'en',
  'un',
  'una',
  'al',
  'victoria',
  'goles',
  'partido',
  'también',
  'entonces',
  'pero',
  'muy',
]);
/**
 * Sem palavras que também existam em pt/es ("a", "no", "do", "con"... e "for", que é verbo em pt: "se for
 * campeão").
 */
const EN_WORDS = new Set([
  'the',
  'and',
  'of',
  'with',
  'was',
  'were',
  'has',
  'have',
  'their',
  'its',
  'after',
  'from',
  'by',
  'at',
  'this',
  'that',
  'which',
  'still',
  'also',
  'against',
  'into',
  'while',
  'but',
  'will',
  'needs',
  'win',
  'won',
  'beat',
  'draw',
  'goals',
  'match',
  'points',
]);
const PT_SUFFIXES = ['ção', 'ções', 'ões', 'ãos'];
const ES_SUFFIXES = ['ción', 'ciones'];

/** Pontua o texto como pt, es ou en; `null` quando não há sinal suficiente (textos muito curtos ou empate). */
export function detectLanguage(text: string): AgentLanguage | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score: Record<AgentLanguage, number> = { pt: 0, es: 0, en: 0 };
  for (const w of words) {
    if (PT_WORDS.has(w)) score.pt++;
    if (ES_WORDS.has(w)) score.es++;
    if (EN_WORDS.has(w)) score.en++;
    if (PT_SUFFIXES.some((s) => w.endsWith(s)) || /[ãõç]/u.test(w)) score.pt++;
    if (ES_SUFFIXES.some((s) => w.endsWith(s)) || w.includes('ñ')) score.es++;
  }
  const [first, second] = (Object.entries(score) as [AgentLanguage, number][]).sort((a, b) => b[1] - a[1]);
  if (first![1] < 2 || first![1] === second![1]) return null;
  return first![0];
}

/** Escapa um termo para uso em RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
