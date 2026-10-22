import { readFileSync } from 'node:fs';
import { buildOpenApiDocument } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { DOC_SECTIONS, docGuides, docRequests, DOCS_NAV, docSections } from './docs';
import { operationAnchor, requestQuery, type ApiRequest } from './galaxie/request';
import { apiReferenceTags, scalarUrl, tagId } from './openapi-reference';
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

describe('seções dos guias', () => {
  /** `<DocSection id="…" title={text.<chave>.title}>` do arquivo da página. */
  const sectionsInFile = (href: string) => {
    const dir = href.replace(/^\/docs\/?/, '');
    const file = new URL(`../app/[locale]/(app)/docs/${dir ? `${dir}/` : ''}page.tsx`, import.meta.url);
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/<DocSection\s+id="([^"]+)"\s+title=\{text\.(\w+)\.title\}/g)].map((m) => [
      m[1]!,
      m[2]!,
    ]);
  };

  it.each(DOCS_NAV.filter((d) => d.id !== 'reference').map((d) => [d.href, d] as const))(
    '%s: o manifesto (árvore, sumário e busca) bate com a página',
    (href, doc) => {
      expect(DOC_SECTIONS[doc.id]?.map(([id, key]) => [id, key])).toEqual(sectionsInFile(href));
    },
  );

  it('os títulos saem do dicionário de cada idioma', () => {
    for (const locale of LOCALES) {
      const t = getDictionary(locale);
      for (const guide of docGuides(t)) {
        expect(guide.label).toBe(t.code.docsNav[guide.id].label);
        for (const s of guide.sections) expect(s.title, `${locale} ${guide.href}#${s.id}`).not.toBe(s.id);
      }
    }
    expect(docSections('concepts', getDictionary('en')).map((s) => s.id)).toContain('cache');
  });
});

describe('referência (OpenAPI → árvore e busca)', () => {
  const tags = apiReferenceTags(getDictionary('pt-BR'));

  it('cobre todas as operações do documento, cada uma com âncora única', () => {
    const total = Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).length, 0);
    const anchors = tags.flatMap((t) => t.operations.map((o) => o.anchor));
    expect(anchors).toHaveLength(total);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(tags[0]?.name).toBe('Catálogo');
    expect(tagId('Times e pessoas')).toBe('tag-times-e-pessoas');
  });

  it('curl com os parâmetros obrigatórios e link do Scalar por operação', () => {
    const ops = tags.flatMap((t) => t.operations);
    const search = ops.find((o) => o.route === '/v1/search');
    expect(search?.tag).toBe('Busca');
    expect(search?.curl).toContain('/v1/search?q=verdao');
    expect(search?.curl).toContain('x-galaxie-key: SUA_CHAVE');
    expect(scalarUrl('Times e pessoas', 'get', '/v1/teams')).toMatch(
      /\/docs#tag\/times-e-pessoas\/GET\/v1\/teams$/,
    );
    expect(ops.find((o) => o.route === '/v1/account/keys/rotate')?.curl.startsWith('curl -X POST ')).toBe(
      true,
    );
  });
});
