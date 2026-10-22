import { buildOpenApiDocument, createGalaxieClient } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import {
  competitionEventsRequest,
  competitionRequest,
  countryCompetitionsRequest,
  derbyRequest,
  eventContextRequest,
  eventRequest,
  exploreSummaryRequest,
  h2hRequest,
  lineupsRequest,
  liveEventsRequest,
  localeQuery,
  personRequest,
  sportCompetitionsRequest,
  squadRequest,
  standingsRequest,
  statsRequest,
  teamOverviewRequest,
  teamSemanticRequest,
  timelineRequest,
  venueRequest,
  whereToWatchRequest,
} from './api';
import { requestPath, requestQuery, requestSnippets, requestUrl, type ApiRequest } from './request';

const BASE = 'https://api.example.test';
const TEAM = '01a15fba-ec17-7d8b-90d7-47b3ccbe967e';
const EVENT = '01a163b8-68bc-7949-b05e-ed332d0f576a';
const COMPETITION = '01a15fba-af59-76bd-acc9-e458185511a8';

/** URL que o cliente tipado (o mesmo dos fetchers) pede para a chamada. */
async function clientUrl(call: (c: ReturnType<typeof createGalaxieClient>) => Promise<unknown>) {
  let url = '';
  const client = createGalaxieClient({
    baseUrl: BASE,
    apiKey: 'chave-de-teste',
    ...localeQuery('pt-BR'),
    fetch: async (input) => {
      url = String(input);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await call(client);
  return url;
}

/** Caminho + query ordenada (a ordem dos parâmetros não muda a requisição). */
function normalize(url: string) {
  const u = new URL(url);
  u.searchParams.sort();
  return `${u.pathname}?${u.searchParams}`;
}

/** Cada descritor ao lado da chamada do cliente tipado que o fetcher correspondente faz. */
const PAIRS: [string, ApiRequest, (c: ReturnType<typeof createGalaxieClient>) => Promise<unknown>][] = [
  ['home', exploreSummaryRequest('pt-BR'), (c) => c.exploreSummary()],
  ['país', countryCompetitionsRequest('br', 'pt-BR'), (c) => c.countryCompetitions('BR')],
  [
    'esporte',
    sportCompetitionsRequest('football', 'pt-BR'),
    (c) => c.competitions({ sport: 'football', tier: 1, limit: 200 }),
  ],
  [
    'competição',
    competitionRequest('brasileirao-serie-a', 'pt-BR'),
    (c) => c.competition('brasileirao-serie-a'),
  ],
  ['tabela', standingsRequest(COMPETITION, 2026, 'pt-BR'), (c) => c.standings(COMPETITION, 2026)],
  [
    'jogos da competição',
    competitionEventsRequest(COMPETITION, '2026-01-01', '2026-12-31', 'pt-BR'),
    (c) => c.events({ competition: COMPETITION, from: '2026-01-01', to: '2026-12-31', limit: 200 }),
  ],
  ['overview', teamOverviewRequest(TEAM, 'pt-BR'), (c) => c.teamOverview(TEAM)],
  ['semântica', teamSemanticRequest(TEAM, 'pt-BR'), (c) => c.teamSemantic(TEAM)],
  ['elenco', squadRequest(TEAM, 'pt-BR'), (c) => c.squad(TEAM)],
  [
    'overview na temporada',
    teamOverviewRequest(TEAM, 'pt-BR', 2025),
    (c) => c.teamOverview(TEAM, { season: 2025 }),
  ],
  ['elenco na temporada', squadRequest(TEAM, 'pt-BR', 2025), (c) => c.squad(TEAM, { season: 2025 })],
  ['evento', eventRequest(EVENT, 'pt-BR'), (c) => c.event(EVENT)],
  ['evento no mercado', eventRequest(EVENT, 'pt-BR', 'BR'), (c) => c.event(EVENT, { market: 'BR' })],
  ['h2h', h2hRequest(EVENT, 'pt-BR'), (c) => c.eventH2h(EVENT, { limit: 10 })],
  ['contexto', eventContextRequest(EVENT, 'pt-BR'), (c) => c.eventContext(EVENT)],
  ['onde assistir', whereToWatchRequest(EVENT, 'BR', 'pt-BR'), (c) => c.whereToWatch(EVENT, 'BR')],
  ['escalações', lineupsRequest(EVENT, 'pt-BR'), (c) => c.eventLineups(EVENT)],
  ['estatísticas', statsRequest(EVENT, 'pt-BR'), (c) => c.eventStats(EVENT)],
  ['ao vivo', liveEventsRequest('pt-BR'), (c) => c.liveEvents({ market: 'BR' })],
  ['minuto a minuto', timelineRequest(EVENT, 'pt-BR'), (c) => c.eventTimeline(EVENT)],
  ['pessoa', personRequest(TEAM, 'pt-BR'), (c) => c.person(TEAM)],
  ['local', venueRequest(TEAM, 'pt-BR'), (c) => c.venue(TEAM)],
  ['clássico', derbyRequest('choque-rei', 'pt-BR'), (c) => c.derby('choque-rei')],
];

type Parameter = { name: string; in: string };
const spec = buildOpenApiDocument() as unknown as {
  paths: Record<string, { get?: { parameters?: Parameter[] } }>;
};

describe('descritores das chamadas', () => {
  it.each(PAIRS)('%s: mesma URL do cliente tipado', async (_name, req, call) => {
    expect(normalize(requestUrl(req, BASE))).toBe(normalize(await clientUrl(call)));
  });

  it.each(PAIRS)('%s: rota e parâmetros existem no OpenAPI', (_name, req) => {
    const op = spec.paths[req.route]?.get;
    expect(op, `rota ${req.route}`).toBeDefined();
    const declared = (op?.parameters ?? []).map((p) => `${p.in}:${p.name}`);
    for (const name of Object.keys(req.params ?? {})) expect(declared).toContain(`path:${name}`);
    for (const [name] of requestQuery(req)) expect(declared).toContain(`query:${name}`);
    expect(requestPath(req)).not.toMatch(/[{}]/);
  });
});

describe('idioma das chamadas', () => {
  it('pt-BR pede pt-BR no fuso de São Paulo', () => {
    expect(localeQuery('pt-BR')).toEqual({ locale: 'pt-BR', tz: 'America/Sao_Paulo' });
  });

  it('espanhol e inglês pedem es-AR (a API não fala inglês)', () => {
    const es = { locale: 'es-AR', tz: 'America/Argentina/Buenos_Aires' };
    expect(localeQuery('es-AR')).toEqual(es);
    expect(localeQuery('en')).toEqual(es);
    expect(requestUrl(eventRequest(EVENT, 'en'), BASE)).toContain('locale=es-AR');
  });

  it('pede o conteúdo na voz do país e descreve no idioma da tela', () => {
    const req = teamOverviewRequest(TEAM, 'en', undefined, 'es-CL');
    expect(requestUrl(req, BASE)).toContain('locale=es-CL');
    expect(requestUrl(req, BASE)).toContain('tz=America%2FSantiago');
    expect(req.description).toMatch(/^The team card/);
  });

  it('descreve a chamada no idioma da demo', () => {
    expect(eventRequest(EVENT, 'pt-BR').description).toMatch(/^Evento completo/);
    expect(eventRequest(EVENT, 'en').description).toMatch(/^Full event/);
    expect(eventRequest(EVENT, 'es-AR').description).toMatch(/^Evento completo: participantes, resultado/);
  });
});

describe('exemplos de código', () => {
  const [curl, ts, py] = requestSnippets(whereToWatchRequest(EVENT, 'BR', 'pt-BR'), BASE).map((s) => s.code);

  it('usam a chave de exemplo, nunca uma real', () => {
    for (const code of [curl, ts, py]) expect(code).toContain('SUA_CHAVE');
    expect(curl).toContain(`${BASE}/v1/events/${EVENT}/where-to-watch?country=BR&locale=pt-BR`);
  });

  it('montam a query em cada linguagem', () => {
    expect(ts).toContain("country: 'BR'");
    expect(ts).toContain("tz: 'America/Sao_Paulo'");
    expect(py).toContain('"country": "BR"');
    expect(py).toContain(`"${BASE}/v1/events/${EVENT}/where-to-watch"`);
  });

  it('comentários e chave de exemplo no idioma da tela (sem idioma, pt-BR)', () => {
    expect(ts).toContain('// Erros seguem a RFC 9457');
    expect(py).toContain('# 4xx/5xx: corpo em application/problem+json');

    const req = whereToWatchRequest(EVENT, 'BR', 'en');
    const [enCurl, enTs, enPy] = requestSnippets(req, BASE, 'en').map((s) => s.code);
    for (const code of [enCurl, enTs, enPy]) expect(code).toContain('YOUR_KEY');
    expect(enTs).toContain('// Errors follow RFC 9457');
    expect(enPy).toContain('# 4xx/5xx: body in application/problem+json');

    const [esCurl, esTs, esPy] = requestSnippets(req, BASE, 'es-AR').map((s) => s.code);
    for (const code of [esCurl, esTs, esPy]) expect(code).toContain('TU_CLAVE');
    expect(esTs).toContain('// Los errores siguen la RFC 9457');
    expect(esPy).toContain('# 4xx/5xx: cuerpo en application/problem+json');
    // O código em si não muda com o idioma: só comentários e a chave de exemplo.
    expect(esCurl.replace('TU_CLAVE', 'YOUR_KEY')).toBe(enCurl);
  });
});
