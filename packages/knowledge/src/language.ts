/**
 * Heurística de idioma (português × espanhol) para os textos livres da base. Conta palavras funcionais
 * exclusivas de cada idioma, em minúsculas — nomes próprios (Verdão, São Paulo, Peñarol) não contam.
 * Serve para o validador apontar texto no idioma errado (fato em português num arquivo `text_locale: es`
 * ou numa tradução `es-AR`); texto curto ou ambíguo devolve null.
 */

const PT_WORDS = new Set([
  'não',
  'em',
  'do',
  'da',
  'dos',
  'das',
  'os',
  'as',
  'pelo',
  'pela',
  'pelos',
  'pelas',
  'foi',
  'é',
  'com',
  'um',
  'uma',
  'ao',
  'aos',
  'à',
  'na',
  'mais',
  'também',
  'seu',
  'sua',
  'nasceu',
  'torcida',
  'time',
]);

const ES_WORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'del',
  'en',
  'fue',
  'es',
  'y',
  'su',
  'sus',
  'al',
  'un',
  'una',
  'más',
  'también',
  'nació',
  'hinchada',
  'afición',
  'equipo',
]);

// pretérito: adotou, ganhou × adoptó, ganó
const PT_SUFFIX = /(ção|ções|ões|campeão|campeã|campeões|\p{L}{2}ou)$/u;
const ES_SUFFIX = /(ción|ciones|campeón|campeona|campeones|\p{L}{2}ó)$/u;

export type TextLanguage = 'pt' | 'es';

export function guessLanguage(text: string): TextLanguage | null {
  let pt = 0;
  let es = 0;
  for (const raw of text.split(/[^\p{L}]+/u)) {
    if (!raw || raw !== raw.toLowerCase()) continue;
    if (PT_WORDS.has(raw) || PT_SUFFIX.test(raw)) pt++;
    if (ES_WORDS.has(raw) || ES_SUFFIX.test(raw)) es++;
  }
  if (pt >= 2 && pt > es * 2) return 'pt';
  if (es >= 2 && es > pt * 2) return 'es';
  return null;
}

/** Idioma de um locale de texto (pt-BR → pt; es, es-AR → es). */
export const languageOf = (locale: string): TextLanguage => (locale.startsWith('pt') ? 'pt' : 'es');

/**
 * Cadeia de fallback dos campos localizados (`labels`, `nicknames`): es-AR → es → en; pt-BR → pt → en.
 * É a mesma da API (`pickText`/`pickList` em apps/api/src/i18n.ts), para o validador ver o que ela serve.
 */
export function fallbackChain(locale: string): string[] {
  const lang = locale.split('-')[0]!;
  return [...new Set([locale, lang, 'en'])];
}
