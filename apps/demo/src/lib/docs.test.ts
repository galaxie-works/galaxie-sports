import { buildOpenApiDocument } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { docRequests, DOCS_NAV } from './docs';
import { operationAnchor, requestQuery, type ApiRequest } from './galaxie/request';
import { LOCALES } from './i18n/config';
import { getDictionary } from './i18n/dictionary';

type Parameter = { name: string; in: string };
const spec = buildOpenApiDocument() as unknown as {
  paths: Record<string, Record<string, { parameters?: Parameter[] }>>;
};

/** Os exemplos de cada idioma (mudam a descrição e o `?locale`/`?tz`). */
const EXAMPLES = LOCALES.flatMap((locale) =>
  (Object.entries(docRequests({ locale, t: getDictionary(locale) })) as [string, ApiRequest][]).map(
    ([name, req]) => [`${locale} ${name}`, req] as [string, ApiRequest],
  ),
);

describe('exemplos dos guias', () => {
  it.each(EXAMPLES)('%s: rota e parâmetros existem no OpenAPI', (_name, req) => {
    const op = spec.paths[req.route]?.[req.method.toLowerCase()];
    expect(op, `${req.method} ${req.route}`).toBeDefined();
    const declared = (op?.parameters ?? []).map((p) => `${p.in}:${p.name}`);
    for (const name of Object.keys(req.params ?? {})) expect(declared).toContain(`path:${name}`);
    for (const [name] of requestQuery(req)) expect(declared).toContain(`query:${name}`);
  });

  it('descrevem a chamada no idioma da tela; o locale da query é um que a API aceita', () => {
    const [pt, en, es] = LOCALES.map((locale) => docRequests({ locale, t: getDictionary(locale) }));
    expect(new Set([pt!.overview.description, en!.overview.description, es!.overview.description]).size).toBe(
      3,
    );
    expect(pt!.overview.query.locale).toBe('pt-BR');
    expect(en!.overview.query.locale).toBe('pt-BR');
    expect(es!.overview.query).toEqual({ locale: 'es-AR', tz: 'America/Argentina/Buenos_Aires' });
    for (const r of [pt, en, es]) expect(r!.competitionEs.query.locale).toBe('es-AR');
  });

  it('rotas citadas nos guias existem no OpenAPI', () => {
    for (const [method, route] of [
      ['post', '/v1/account/keys/rotate'],
      ['get', '/v1/account/keys'],
      ['get', '/v1/stream'],
      ['get', '/v1/sports'],
      ['get', '/v1/navigation'],
      ['get', '/v1/countries'],
      ['get', '/v1/competitions/{id}'],
      ['get', '/v1/competitions/{id}/context'],
      ['get', '/v1/events'],
      ['get', '/v1/events/{id}'],
      ['get', '/v1/events/{id}/where-to-watch'],
      ['get', '/v1/events/{id}/context'],
      ['get', '/v1/teams'],
      ['get', '/v1/teams/{id}/overview'],
      ['get', '/v1/teams/{id}/semantic'],
      ['get', '/v1/teams/{id}/rivals'],
      ['get', '/v1/people/{id}'],
      ['get', '/v1/derbies'],
      ['get', '/v1/glossary'],
      ['get', '/v1/copy'],
      ['get', '/v1/multisport/games/{slug}/medals'],
      ['get', '/v1/multisport/history/medals'],
      ['get', '/v1/account'],
      ['get', '/v1/account/usage'],
      ['get', '/v1/derbies/{slug}'],
      ['get', '/v1/multisport/games'],
      ['get', '/mirror/{sport}/{endpoint}'],
    ] as const) {
      expect(spec.paths[route]?.[method], `${method} ${route}`).toBeDefined();
    }
  });
});

describe('navegação', () => {
  it('cada guia tem um caminho e um id únicos em /docs', () => {
    const hrefs = DOCS_NAV.map((d) => d.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(DOCS_NAV.map((d) => d.id)).size).toBe(DOCS_NAV.length);
    for (const h of hrefs) expect(h.startsWith('/docs')).toBe(true);
  });

  it('todo guia tem rótulo e descrição nos três idiomas', () => {
    for (const locale of LOCALES) {
      const nav = getDictionary(locale).code.docsNav;
      expect(Object.keys(nav).sort()).toEqual(DOCS_NAV.map((d) => d.id).sort());
    }
  });

  it('âncora da referência é estável', () => {
    expect(operationAnchor('GET', '/v1/teams/{id}/overview')).toBe('get-v1-teams-id-overview');
  });
});
