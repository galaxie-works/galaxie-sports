import { describe, expect, it } from 'vitest';

import { LOCALES } from './config';
import { NAMESPACES } from './dictionary';
import { placeholdersOf } from './text';

type Tree = { [key: string]: string | Tree };

/** Folhas do dicionário como `caminho.da.chave → texto`. */
function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

const namespaces = Object.entries(NAMESPACES) as [string, Record<(typeof LOCALES)[number], Tree>][];
const translations = LOCALES.filter((l) => l !== 'pt-BR');

describe.each(namespaces)('dicionário %s', (_name, messages) => {
  const base = leaves(messages['pt-BR']);

  it.each(translations)('%s tem exatamente as chaves do pt-BR', (locale) => {
    expect([...leaves(messages[locale]).keys()].sort()).toEqual([...base.keys()].sort());
  });

  it.each(LOCALES)('%s não tem texto vazio', (locale) => {
    const empty = [...leaves(messages[locale])].filter(([, text]) => !text.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it.each(translations)('%s usa as mesmas variáveis {x} e tags <x> do pt-BR', (locale) => {
    const other = leaves(messages[locale]);
    const diff = [...base]
      .filter(([key, text]) => placeholdersOf(text).join() !== placeholdersOf(other.get(key) ?? '').join())
      .map(([key]) => key);
    expect(diff).toEqual([]);
  });

  it.each(translations)('%s não ficou em português (sem ã, õ, ç)', (locale) => {
    const leftovers = [...leaves(messages[locale])]
      .filter(([, text]) => /[ãõçÃÕÇ]/.test(text))
      .map(([key, text]) => `${key}: ${text}`);
    expect(leftovers).toEqual([]);
  });
});
