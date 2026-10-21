import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';
import { CompetitionsQuery } from './catalog.js';
import { LocaleQuery } from './common.js';
import { GamesListQuery, MedalHistoryQuery, ScheduleQuery } from './multisport.js';
import { CopyQuery } from './semantic.js';
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
        '/v1/account',
        '/v1/account/keys',
        '/v1/account/keys/rotate',
        '/v1/account/usage',
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

describe('OpenAPI — semântica e multiesporte', () => {
  it('publica as rotas de docs/06 §5 e docs/08 §4', () => {
    const doc = buildOpenApiDocument();
    expect(Object.keys(doc.paths ?? {})).toEqual(
      expect.arrayContaining([
        '/v1/derbies',
        '/v1/derbies/upcoming',
        '/v1/derbies/{slug}',
        '/v1/teams/{id}/semantic',
        '/v1/teams/{id}/rivals',
        '/v1/glossary',
        '/v1/copy',
        '/v1/multisport/games',
        '/v1/multisport/games/{slug}/medals',
        '/v1/multisport/games/{slug}/schedule',
        '/v1/multisport/games/{slug}/events/{id}',
        '/v1/multisport/games/{slug}/nocs/{noc}/athletes',
        '/v1/multisport/games/{slug}/today/{noc}',
        '/v1/multisport/history/medals',
      ]),
    );
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'Derby',
        'TeamSemantic',
        'GlossaryTerm',
        'CopySuggestion',
        'MedalTable',
        'MedalHistory',
      ]),
    );
  });

  it('normaliza listas de tipos e CONs e aplica padrões', () => {
    expect(MedalHistoryQuery.parse({ noc: 'bra, arg' })).toMatchObject({
      noc: ['BRA', 'ARG'],
      type: ['OG', 'PAN'],
    });
    expect(GamesListQuery.parse({ type: 'og' }).type).toEqual(['OG']);
    expect(GamesListQuery.safeParse({ type: 'XX' }).success).toBe(false);
    expect(ScheduleQuery.parse({ medal_only: 'true', noc: 'bra' })).toMatchObject({
      medal_only: true,
      noc: 'BRA',
      limit: 50,
    });
    expect(CopyQuery.parse({ intent: 'cheer' })).toMatchObject({ sport: 'football', tone: 2 });
    expect(CopyQuery.safeParse({ intent: 'cheer', min_review_status: 'qualquer' }).success).toBe(false);
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
