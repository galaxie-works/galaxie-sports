import type { Locale } from './config';

/**
 * Textos de um assunto nos três idiomas. O pt-BR define o formato; inglês e espanhol têm de ter
 * exatamente as mesmas chaves (o TypeScript recusa chave a mais ou a menos, e o teste dos dicionários
 * confere também as variáveis `{x}` e as tags `<x>` de cada texto).
 */
export function defineMessages<T extends object>(
  ptBR: T,
  translations: { en: NoInfer<T>; 'es-AR': NoInfer<T> },
): Record<Locale, T> {
  return { 'pt-BR': ptBR, ...translations };
}
