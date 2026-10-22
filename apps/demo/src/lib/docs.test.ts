import { buildOpenApiDocument } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { DOC_REQUESTS, DOCS_NAV } from './docs';
import { operationAnchor, requestQuery, type ApiRequest } from './galaxie/request';

type Parameter = { name: string; in: string };
const spec = buildOpenApiDocument() as unknown as {
  paths: Record<string, Record<string, { parameters?: Parameter[] }>>;
};

describe('exemplos dos guias', () => {
  it.each(Object.entries(DOC_REQUESTS) as [string, ApiRequest][])(
    '%s: rota e parâmetros existem no OpenAPI',
    (_name, req) => {
      const op = spec.paths[req.route]?.[req.method.toLowerCase()];
      expect(op, `${req.method} ${req.route}`).toBeDefined();
      const declared = (op?.parameters ?? []).map((p) => `${p.in}:${p.name}`);
      for (const name of Object.keys(req.params ?? {})) expect(declared).toContain(`path:${name}`);
      for (const [name] of requestQuery(req)) expect(declared).toContain(`query:${name}`);
    },
  );

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
  it('cada guia tem um caminho único em /docs', () => {
    const hrefs = DOCS_NAV.map((d) => d.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(h.startsWith('/docs')).toBe(true);
  });

  it('âncora da referência é estável', () => {
    expect(operationAnchor('GET', '/v1/teams/{id}/overview')).toBe('get-v1-teams-id-overview');
  });
});
