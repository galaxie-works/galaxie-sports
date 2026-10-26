import { languageOf } from './language.js';
import type { KnowledgeBase } from './load.js';
import { TEXT_LOCALES, type TextLocale } from './types.js';

export interface TextCoverage {
  locale: TextLocale;
  /** Itens com texto livre escrito em outro idioma (precisam de tradução para este mercado). */
  total: number;
  /** Desses, quantos têm tradução no locale ou no idioma (es-AR conta a do es). */
  translated: number;
  /** Traduções próprias do locale (variante regional, para es-XX); com `file`, só as dos itens dele. */
  own: number;
  missing: { kind: 'team' | 'derby'; slug: string; file: string }[];
}

/**
 * Cobertura das traduções de i18n/<locale>.yaml (docs/06 §3.3): quais times e clássicos com texto livre
 * em outro idioma ainda caem no original quando o mercado pede `locale`.
 */
export function textCoverage(kb: KnowledgeBase, locale: TextLocale, file?: string): TextCoverage {
  const lang = languageOf(locale);
  const chain = new Set<string>([locale, locale.split('-')[0]!]);
  const has = new Set(kb.texts.filter((x) => chain.has(x.locale)).map((x) => `${x.listKey}|${x.entry.slug}`));
  // com `file`, só as traduções dos times e clássicos desse arquivo
  const inFile = file
    ? new Set([
        ...kb.teams.filter((t) => t.file === file).map((t) => `teams|${t.entry.slug}`),
        ...kb.derbies.filter((d) => d.file === file).map((d) => `derbies|${d.entry.slug}`),
      ])
    : null;
  const own = kb.texts.filter(
    (x) => x.locale === locale && (!inFile || inFile.has(`${x.listKey}|${x.entry.slug}`)),
  ).length;
  const candidates = [
    ...kb.teams
      .filter((t) => (t.entry.identity ?? []).length || t.entry.mascot)
      .map((t) => ({
        kind: 'team' as const,
        key: `teams|${t.entry.slug}`,
        slug: t.entry.slug,
        file: t.file,
        textLocale: t.textLocale,
      })),
    ...kb.derbies
      .filter((d) => d.entry.origin || (d.entry.trivia ?? []).length)
      .map((d) => ({
        kind: 'derby' as const,
        key: `derbies|${d.entry.slug}`,
        slug: d.entry.slug,
        file: d.file,
        textLocale: d.textLocale,
      })),
  ].filter((c) => languageOf(c.textLocale) !== lang && (!file || c.file === file));
  const missing = candidates
    .filter((c) => !has.has(c.key))
    .map(({ kind, slug, file }) => ({ kind, slug, file }));
  return { locale, total: candidates.length, translated: candidates.length - missing.length, own, missing };
}

/** Cobertura de todos os locales de texto, na ordem de TEXT_LOCALES (`file` restringe a um arquivo). */
export const allTextCoverage = (kb: KnowledgeBase, file?: string) =>
  TEXT_LOCALES.map((l) => textCoverage(kb, l, file));
