import { splitSentences } from './text.js';

/**
 * Limites de tamanho por superfície. TV conectada é lida à distância: textos curtos (docs/06 §4.3).
 * `total` e `sentence` em caracteres; `sentences` = máximo de frases.
 */
export const SURFACES = ['tv', 'mobile', 'web'] as const;
export type Surface = (typeof SURFACES)[number];

export interface LengthLimits {
  total: number;
  sentence: number;
  sentences: number;
}

export const MAX_LENGTH: Record<Surface, LengthLimits> = {
  tv: { total: 320, sentence: 160, sentences: 3 },
  mobile: { total: 600, sentence: 240, sentences: 4 },
  web: { total: 1200, sentence: 320, sentences: 8 },
};

export interface LengthViolation {
  kind: 'too_long' | 'sentence_too_long' | 'too_many_sentences' | 'empty';
  detail: string;
}

/** Confere o texto contra os limites da superfície. Lista vazia = cabe. */
export function checkLength(text: string, surface: Surface): LengthViolation[] {
  const limits = MAX_LENGTH[surface];
  const out: LengthViolation[] = [];
  const trimmed = text.trim();
  if (!trimmed) return [{ kind: 'empty', detail: 'texto vazio' }];
  if (trimmed.length > limits.total)
    out.push({
      kind: 'too_long',
      detail: `${trimmed.length} caracteres (máx. ${limits.total} em ${surface})`,
    });
  const sentences = splitSentences(trimmed);
  if (sentences.length > limits.sentences)
    out.push({
      kind: 'too_many_sentences',
      detail: `${sentences.length} frases (máx. ${limits.sentences} em ${surface})`,
    });
  for (const s of sentences) {
    if (s.length > limits.sentence)
      out.push({
        kind: 'sentence_too_long',
        detail: `frase com ${s.length} caracteres (máx. ${limits.sentence} em ${surface})`,
      });
  }
  return out;
}

/** Superfícies em que o texto cabe (ex.: `{ tv: false, mobile: true, web: true }`). */
export function surfaceFit(text: string): Record<Surface, boolean> {
  return Object.fromEntries(SURFACES.map((s) => [s, checkLength(text, s).length === 0])) as Record<
    Surface,
    boolean
  >;
}
