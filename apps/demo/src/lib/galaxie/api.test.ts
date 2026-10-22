import { buildOpenApiDocument, createGalaxieClient } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import {
  competitionEventsRequest,
  competitionRequest,
  countryCompetitionsRequest,
  derbyRequest,
  eventContextRequest,
  eventRequest,
  h2hRequest,
  LOCALE,
  lineupsRequest,
  personRequest,
  sportCompetitionsRequest,
  squadRequest,
  standingsRequest,
  teamOverviewRequest,
  teamSemanticRequest,
  TZ,
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
    locale: LOCALE,
    tz: TZ,
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
  ['país', countryCompetitionsRequest('br'), (c) => c.countryCompetitions('BR')],
  [
    'esporte',
    sportCompetitionsRequest('football'),
    (c) => c.competitions({ sport: 'football', tier: 1, limit: 200 }),
  ],
  ['competição', competitionRequest('brasileirao-serie-a'), (c) => c.competition('brasileirao-serie-a')],
  ['tabela', standingsRequest(COMPETITION, 2026), (c) => c.standings(COMPETITION, 2026)],
  [
    'jogos da competição',
    competitionEventsRequest(COMPETITION, '2026-01-01', '2026-12-31'),
    (c) => c.events({ competition: COMPETITION, from: '2026-01-01', to: '2026-12-31', limit: 200 }),
  ],
  ['overview', teamOverviewRequest(TEAM), (c) => c.teamOverview(TEAM)],
  ['semântica', teamSemanticRequest(TEAM), (c) => c.teamSemantic(TEAM)],
  ['elenco', squadRequest(TEAM), (c) => c.squad(TEAM)],
  ['evento', eventRequest(EVENT), (c) => c.event(EVENT)],
  ['h2h', h2hRequest(EVENT), (c) => c.eventH2h(EVENT, { limit: 10 })],
  ['contexto', eventContextRequest(EVENT), (c) => c.eventContext(EVENT)],
  ['onde assistir', whereToWatchRequest(EVENT, 'BR'), (c) => c.whereToWatch(EVENT, 'BR')],
  ['escalações', lineupsRequest(EVENT), (c) => c.eventLineups(EVENT)],
  ['pessoa', personRequest(TEAM), (c) => c.person(TEAM)],
  ['local', venueRequest(TEAM), (c) => c.venue(TEAM)],
  ['clássico', derbyRequest('choque-rei'), (c) => c.derby('choque-rei')],
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

describe('exemplos de código', () => {
  const [curl, ts, py] = requestSnippets(whereToWatchRequest(EVENT, 'BR'), BASE).map((s) => s.code);

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
});
