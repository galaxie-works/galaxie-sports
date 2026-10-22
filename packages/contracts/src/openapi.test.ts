import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';
import { CompetitionsQuery } from './catalog.js';
import { LocaleQuery } from './common.js';
import { GamesListQuery, MedalHistoryQuery, ScheduleQuery } from './multisport.js';
import { CopyQuery } from './semantic.js';
import { TeamColors, teamGradient } from './teams.js';
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
        '/v1/events/{id}/context',
        '/v1/events/{id}.ics',
        '/v1/teams',
        '/v1/teams/{id}',
        '/v1/teams/{id}/overview',
        '/v1/teams/{id}/events',
        '/v1/teams/{id}/squad',
        '/v1/people/{id}',
        '/mirror/{sport}/{endpoint}',
        '/v1/events/{id}/where-to-watch',
        '/v1/account',
        '/v1/account/keys',
        '/v1/account/keys/rotate',
        '/v1/account/usage',
        '/v1/navigation',
        '/v1/countries/{code}',
        '/v1/countries/{code}/competitions',
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
        'EventParticipant',
        'FanTag',
        'FanCheer',
        'EventReferee',
        'EventContext',
        'EventContextText',
        'EventContextSummary',
        'TeamSummary',
        'Team',
        'TeamColors',
        'TeamOverview',
        'Person',
        'WhereToWatch',
        'WhereToWatchOption',
      ]),
    );
    const team = doc.components?.schemas?.Team as { properties?: Record<string, unknown> };
    expect(team.properties).toHaveProperty('colors');
    expect(doc.components?.schemas?.TeamColors).toMatchObject({
      properties: { gradient: { example: 'linear-gradient(9deg, #000 0%, #006937 100%)' } },
      required: ['primary', 'secondary', 'monochrome', 'gradient'],
    });
    const overview = doc.components?.schemas?.TeamOverview as { required?: string[] };
    expect(overview.required).toContain('competitions');
    expect(doc.components?.schemas?.TeamCampaign).toMatchObject({
      properties: {
        status: {
          enum: [
            'champion',
            'runner_up',
            'third_place',
            'in_progress',
            'eliminated',
            'league',
            'finished_league',
          ],
        },
        label: { example: { 'pt-BR': 'Na final' } },
      },
      required: expect.arrayContaining(['status', 'stage_kind', 'label', 'detail', 'decided_by_event_id']),
    });
    expect(doc.components?.schemas).toHaveProperty('TeamCompetition');
    expect(doc.components?.securitySchemes?.galaxieKey).toMatchObject({
      in: 'header',
      name: 'x-galaxie-key',
    });
  });
});

describe('OpenAPI — tags do torcedor', () => {
  type Schema = {
    properties?: Record<string, Schema & { $ref?: string }>;
    required?: string[];
    example?: unknown;
    items?: Schema & { $ref?: string };
    anyOf?: (Schema & { $ref?: string })[];
  };
  const schemas = () => buildOpenApiDocument().components?.schemas as Record<string, Schema>;

  it('stake traz o participante (`team_id`, null em `both`)', () => {
    const stake = schemas().EventStake!;
    expect(stake.required).toEqual(expect.arrayContaining(['team', 'team_id', 'code', 'text']));
    expect(stake.properties?.team_id).toBeDefined();
  });

  it('participante traz `fan_tags` (obrigatório) e `cheer` (opcional)', () => {
    const p = schemas().EventParticipant!;
    expect(p.required).toEqual(expect.arrayContaining(['fan_tags']));
    expect(p.required).not.toContain('cheer');
    expect(p.properties?.fan_tags?.items?.$ref).toBe('#/components/schemas/FanTag');
    expect(p.properties?.fan_tags?.example).toEqual([
      { code: 'in_title_race', priority: 15, text: { 'pt-BR': 'Na briga pelo título' } },
      {
        code: 'can_qualify_for_libertadores_group_stage',
        priority: 43,
        text: { 'pt-BR': 'De olho na Libertadores' },
      },
    ]);
    const tag = schemas().FanTag!;
    expect(tag.required).toEqual(expect.arrayContaining(['code', 'priority', 'text']));
    expect(tag.properties?.text?.example).toEqual({ 'pt-BR': 'Na briga pelo título' });
    const cheer = schemas().FanCheer!;
    expect(cheer.required).toEqual(['text']);
    expect(cheer.properties?.text?.example).toBe('Avanti, Palestra!');
  });
});

describe('OpenAPI — árbitro e local do evento', () => {
  it('Event traz `referee` (nome e país) e `venue` (nome e cidade), ambos anuláveis', () => {
    const schemas = buildOpenApiDocument().components?.schemas as Record<
      string,
      { properties?: Record<string, { example?: unknown; description?: string }>; required?: string[] }
    >;
    expect(schemas.Event!.required).toEqual(expect.arrayContaining(['venue', 'referee']));
    expect(schemas.Event!.properties?.venue?.example).toMatchObject({
      name: 'Allianz Parque',
      city: 'São Paulo',
    });
    const referee = schemas.EventReferee!;
    expect(referee.required).toEqual(['name', 'country']);
    expect(referee.properties?.name?.example).toBe('Wilton Pereira Sampaio');
    expect(referee.properties?.country?.example).toBe('Brazil');
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

  it('cores do time: gradiente sugerido a partir da primária e hex validado', () => {
    expect(teamGradient('#006937')).toBe('linear-gradient(9deg, #000 0%, #006937 100%)');
    const colors = {
      primary: '#006937',
      secondary: null,
      monochrome: false,
      gradient: teamGradient('#006937'),
    };
    expect(TeamColors.parse(colors)).toEqual(colors);
    expect(() => TeamColors.parse({ ...colors, primary: 'green' })).toThrow();
  });
});
