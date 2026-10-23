import {
  AI_PROVIDERS,
  APISPORTS_APIS,
  SCHEDULED_JOBS,
  SETTINGS,
  planKey,
  scheduleKey,
} from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';

import { LOCALES } from './config';
import { DICTIONARIES, EXAMPLE_NAMESPACES, PUBLIC_NAMESPACES, clientDictionary } from './dictionary';

/**
 * Termos internos que não podem chegar ao HTML das páginas públicas: as chaves de flag do painel de
 * Operação, o fornecedor de dados e os provedores de IA.
 */
const FLAG_KEYS = [
  ...SETTINGS.map((s) => s.key),
  ...SCHEDULED_JOBS.map((j) => scheduleKey(j.name)),
  ...APISPORTS_APIS.map(planKey),
];
const NAMES = [/api-?sports/i, /api-football/i, ...AI_PROVIDERS.map((p) => new RegExp(p, 'i'))];

function internalTerms(text: string): string[] {
  return [
    ...FLAG_KEYS.filter((key) => text.includes(key)),
    ...NAMES.filter((re) => re.test(text)).map(String),
  ];
}

describe('textos das páginas públicas', () => {
  it('a lista de termos pega os textos da Operação (controle)', () => {
    expect(internalTerms(JSON.stringify(clientDictionary('pt-BR')))).not.toEqual([]);
  });

  it.each(LOCALES)('%s: apresentação, login, termos e exemplo sem termos internos', (locale) => {
    const sent = {
      public: clientDictionary(locale, PUBLIC_NAMESPACES),
      example: clientDictionary(locale, EXAMPLE_NAMESPACES),
      landing: DICTIONARIES[locale].landing,
      site: DICTIONARIES[locale].site,
    };
    expect(internalTerms(JSON.stringify(sent))).toEqual([]);
  });

  it('o navegador das páginas públicas não recebe os assuntos do app logado', () => {
    for (const ns of ['admin', 'ops', 'code', 'docsUi', 'search', 'review'])
      expect([...PUBLIC_NAMESPACES, ...EXAMPLE_NAMESPACES]).not.toContain(ns);
  });
});
