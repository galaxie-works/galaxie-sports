/**
 * Heurística contra letras de hino/canção (direitos autorais — data/knowledge/SCHEMA.md, regra 3).
 * Gritos e slogans são curtos; letra costuma ter várias linhas/versos, muitas palavras ou separadores de verso.
 */

export type LyricVerdict = { level: 'error' | 'warning'; reason: string } | null;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Para gritos de torcida, `cheer` e templates de copy: textos que precisam ser curtos. */
export function checkChant(text: string): LyricVerdict {
  if (/\r?\n/.test(text)) return { level: 'error', reason: 'tem quebra de linha (parece verso de canção)' };
  const verses = text.split(/\s[/|]\s|\s*\/\/\s*/).filter((s) => s.trim());
  if (verses.length >= 3)
    return { level: 'error', reason: 'tem 3+ trechos separados por "/" (parece letra)' };
  const words = wordCount(text);
  if (words > 15) return { level: 'error', reason: `${words} palavras — grito deve ser curto (máx. 15)` };
  if (words > 10)
    return { level: 'warning', reason: `${words} palavras — confira se não é trecho de canção` };
  return null;
}

/** Para textos factuais (identity, trivia, origin): uma frase curta, nunca estrofes. */
export function checkProse(text: string): LyricVerdict {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length >= 3)
    return { level: 'error', reason: `${lines.length} linhas — parece estrofe, não fato curto` };
  const quoted = text.match(/["“”«»][^"“”«»]{60,}["“”«»]/);
  if (quoted)
    return { level: 'warning', reason: 'citação longa entre aspas — confira se não é letra de hino' };
  if (text.length > 300)
    return { level: 'warning', reason: `${text.length} caracteres — prefira uma frase curta` };
  return null;
}

/**
 * Para textos editoriais em parágrafos (a bio do perfil do piloto): parágrafos separados por linha em branco são
 * prosa, não estrofe. Vira erro só a quebra de linha simples dentro de um parágrafo (cara de verso) e a citação longa
 * entre aspas fica como aviso, como em `checkProse`.
 */
export function checkParagraphs(text: string): LyricVerdict {
  const paragraphs = text.split(/\r?\n\s*\r?\n/).filter((p) => p.trim());
  if (paragraphs.some((p) => /\r?\n/.test(p.trim())))
    return { level: 'error', reason: 'quebra de linha dentro do parágrafo — parece verso, não prosa' };
  if (/["“”«»][^"“”«»]{60,}["“”«»]/.test(text))
    return { level: 'warning', reason: 'citação longa entre aspas — confira se não é letra de canção' };
  return null;
}
