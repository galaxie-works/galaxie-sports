/**
 * Utilitários de texto compartilhados pelos guardrails: normalização sem acentos, frases e
 * detecção de idioma (pt × es) por marcadores simples.
 */

/** Os 8 mercados com texto gerado (mesma lista de `@galaxie/rules` e `@galaxie/knowledge`). */
export const AGENT_LOCALES = [
  'pt-BR',
  'es-AR',
  'es-MX',
  'es-CO',
  'es-CL',
  'es-PE',
  'es-UY',
  'es-EC',
] as const;
export type AgentLocale = (typeof AGENT_LOCALES)[number];

export function isAgentLocale(value: string): value is AgentLocale {
  return (AGENT_LOCALES as readonly string[]).includes(value);
}

/** Idioma-base do locale. */
export function languageOf(locale: string): 'pt' | 'es' {
  return locale.toLowerCase().startsWith('pt') ? 'pt' : 'es';
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

/** Divide em frases (ponto final, exclamação, interrogação ou ponto e vírgula seguido de espaço). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
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
const PT_SUFFIXES = ['ção', 'ções', 'ões', 'ãos'];
const ES_SUFFIXES = ['ción', 'ciones'];

/** Pontua o texto como pt ou es; `null` quando não há sinal suficiente (textos muito curtos). */
export function detectLanguage(text: string): 'pt' | 'es' | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  let pt = 0;
  let es = 0;
  for (const w of words) {
    if (PT_WORDS.has(w)) pt++;
    if (ES_WORDS.has(w)) es++;
    if (PT_SUFFIXES.some((s) => w.endsWith(s)) || /[ãõç]/u.test(w)) pt++;
    if (ES_SUFFIXES.some((s) => w.endsWith(s)) || w.includes('ñ')) es++;
  }
  if (pt === es || Math.max(pt, es) < 2) return null;
  return pt > es ? 'pt' : 'es';
}

/** Escapa um termo para uso em RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
