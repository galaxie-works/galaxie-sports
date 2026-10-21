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
        '/v1/competitions/{id}/context',
        '/v1/events',
        '/v1/events/live',
        '/v1/events/{id}',
        '/v1/events/{id}/timeline',
        '/v1/events/{id}/lineups',
        '/v1/events/{id}/stats',
        '/v1/events/{id}/h2h',
        '/v1/events/{id}.ics',
        '/v1/teams',
        '/v1/teams/{id}',
        '/v1/teams/{id}/overview',
        '/v1/teams/{id}/events',
        '/v1/teams/{id}/squad',
        '/v1/people/{id}',
        '/mirror/{sport}/{endpoint}',
      ]),
    );
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'Problem',
        'Competition',
        'CompetitionSummary',
        'CompetitionContext',
        'Event',
        'EventStake',
        'TeamSummary',
        'TeamOverview',
        'Person',
      ]),
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
