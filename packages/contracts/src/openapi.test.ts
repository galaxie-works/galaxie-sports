import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';
import { CompetitionsQuery } from './catalog.js';
import { LocaleQuery } from './common.js';
import { buildOpenApiDocument } from './openapi.js';

describe('OpenAPI', () => {
  it('gera um documento OpenAPI 3.1 válido', async () => {
    const doc = buildOpenApiDocument({ serverUrl: 'http://localhost:8080' });
    const result = await new Validator().validate(JSON.parse(JSON.stringify(doc)));
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(doc.openapi).toBe('3.1.0');
  });

  it('publica as rotas do catálogo, o espelho e os componentes principais', () => {
    const doc = buildOpenApiDocument();
    expect(Object.keys(doc.paths ?? {})).toEqual(
      expect.arrayContaining([
        '/v1/sports',
        '/v1/countries',
        '/v1/competitions',
        '/v1/competitions/{id}',
        '/v1/competitions/{id}/seasons/{season}/standings',
        '/v1/venues/{id}',
        '/mirror/{sport}/{endpoint}',
        '/v1/account',
        '/v1/account/keys',
        '/v1/account/keys/rotate',
        '/v1/account/usage',
      ]),
    );
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['Problem', 'Competition', 'CompetitionSummary', 'Event', 'TeamSummary']),
    );
    expect(doc.components?.securitySchemes?.galaxieKey).toMatchObject({
      in: 'header',
      name: 'x-galaxie-key',
    });
  });
});

describe('schemas de query', () => {
  it('normaliza filtros e aplica limite padrão', () => {
    const q = CompetitionsQuery.parse({ country: 'br', tier: '1', q: '  liber ' });
    expect(q).toMatchObject({ country: 'BR', tier: 1, q: 'liber', limit: 50 });
  });

  it('rejeita locale e fuso desconhecidos', () => {
    expect(LocaleQuery.safeParse({ locale: 'fr-FR' }).success).toBe(false);
    expect(LocaleQuery.safeParse({ tz: 'Mars/Olympus' }).success).toBe(false);
    expect(LocaleQuery.safeParse({ locale: 'es-AR', tz: 'America/Sao_Paulo' }).success).toBe(true);
  });
});
