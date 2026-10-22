/**
 * Leituras da API Galaxie Sports para as páginas (Server Components).
 * Cada função é cacheada (`use cache`): os metadados mudam pouco e a demo precisa navegar sem espera.
 */
import { createGalaxieClient, GalaxieApiError } from '@galaxie/contracts';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';

import type { ApiRequest } from './request';
import { API_URL } from './server';

export const LOCALE = 'pt-BR';
export const TZ = 'America/Sao_Paulo';

/**
 * Descritores das chamadas (botão "Ver código" das seções): cada um fica ao lado do fetcher que faz a
 * mesma requisição. O cliente tipado sempre envia `locale` e `tz`, então os descritores também.
 */
const LOCALE_QUERY = { locale: LOCALE, tz: TZ } as const;

const api = createGalaxieClient({
  baseUrl: API_URL,
  apiKey: process.env.GALAXIE_DEMO_KEY ?? '',
  locale: LOCALE,
  tz: TZ,
});

/** 404 da API vira a página "não encontrado"; os demais erros sobem. */
async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof GalaxieApiError && err.status === 404) notFound();
    throw err;
  }
}

/** Para blocos opcionais da página: sem dado (404) não é erro, só ausência. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof GalaxieApiError && err.status === 404) return null;
    throw err;
  }
}

// ─── país ────────────────────────────────────────────────────────────────────────────────────────

export const countryCompetitionsRequest = (code: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/countries/{code}/competitions',
  params: { code: code.toUpperCase() },
  query: LOCALE_QUERY,
  description: 'Competições do país por esporte e escopo: nacionais, continentais, seleção e mundiais.',
});

export async function getCountryCompetitions(code: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.countryCompetitions(code));
}

// ─── esporte ─────────────────────────────────────────────────────────────────────────────────────

export const sportCompetitionsRequest = (sport: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/competitions',
  query: { sport, tier: 1, limit: 200, ...LOCALE_QUERY },
  description: 'Competições catalogadas de um esporte, paginadas por cursor.',
  note: 'A página repete a chamada com tier=2 e segue o next_cursor até o fim.',
});

/** Competições catalogadas (tier 1–2) de um esporte; o tier 3 é só espelho e fica de fora da vitrine. */
export async function getSportCompetitions(sport: string) {
  'use cache';
  cacheLife('hours');
  const all = [];
  for (const tier of [1, 2]) {
    let cursor: string | undefined;
    do {
      const page = await api.competitions({ sport, tier, limit: 200, cursor });
      all.push(...page.data);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
  return all;
}

// ─── competição ──────────────────────────────────────────────────────────────────────────────────

export const competitionRequest = (idOrSlug: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/competitions/{id}',
  params: { id: idOrSlug },
  query: LOCALE_QUERY,
  description: 'Detalhe da competição (aceita UUID ou slug), com apelidos e temporadas.',
});

export async function getCompetition(idOrSlug: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.competition(idOrSlug));
}

export const standingsRequest = (competitionId: string, season: number): ApiRequest => ({
  method: 'GET',
  route: '/v1/competitions/{id}/seasons/{season}/standings',
  params: { id: competitionId, season },
  query: LOCALE_QUERY,
  description: 'Tabela ou grupos da temporada (o ano ou `current`).',
});

export async function getStandings(competitionId: string, season: number) {
  'use cache';
  cacheLife('hours');
  return orNull(api.standings(competitionId, season));
}

export interface SeasonWindow {
  year: number;
  start: string;
  end: string;
}

/** Temporadas que têm classificação ou jogos (na ordem recebida). */
export async function getSeasonsWithData(competitionId: string, seasons: SeasonWindow[]) {
  'use cache';
  cacheLife('hours');
  const checks = await Promise.all(
    seasons.map(async (s) => {
      const [standings, events] = await Promise.all([
        orNull(api.standings(competitionId, s.year)),
        api.events({ competition: competitionId, from: s.start, to: s.end, limit: 1 }),
      ]);
      const hasStandings = (standings?.groups ?? []).some((g) => g.rows.length > 0);
      return { year: s.year, hasStandings, hasEvents: events.data.length > 0 };
    }),
  );
  return checks.filter((c) => c.hasStandings || c.hasEvents);
}

export const competitionEventsRequest = (competitionId: string, from: string, to: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/events',
  query: { competition: competitionId, from, to, limit: 200, ...LOCALE_QUERY },
  description: 'Jogos da competição na janela da temporada, paginados por cursor.',
  note: 'A página segue o next_cursor (envie ?cursor=<next_cursor>) até juntar a temporada inteira.',
});

/** Todos os jogos de uma janela (segue o cursor; a API devolve até 200 por página). */
export async function getCompetitionEvents(competitionId: string, from: string, to: string) {
  'use cache';
  cacheLife('hours');
  const all = [];
  let cursor: string | undefined;
  do {
    const page = await api.events({ competition: competitionId, from, to, limit: 200, cursor });
    all.push(...page.data);
    cursor = page.next_cursor ?? undefined;
  } while (cursor && all.length < 2000);
  return all;
}

// ─── time ────────────────────────────────────────────────────────────────────────────────────────

export const teamOverviewRequest = (id: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/teams/{id}/overview',
  params: { id },
  query: LOCALE_QUERY,
  description:
    'Card do time em uma chamada: posição nas competições, forma, últimos jogos, ao vivo e próximo jogo.',
});

export async function getTeamOverview(id: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.teamOverview(id));
}

export const teamSemanticRequest = (id: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/teams/{id}/semantic',
  params: { id },
  query: LOCALE_QUERY,
  description: 'Cartão de identidade do time: apelidos, mascote, torcida, gritos, estádio, rivais e fatos.',
  note: 'Exige o módulo semantic.',
});

export async function getTeamSemantic(id: string) {
  'use cache';
  cacheLife('hours');
  return orNull(api.teamSemantic(id));
}

export const squadRequest = (id: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/teams/{id}/squad',
  params: { id },
  query: LOCALE_QUERY,
  description: 'Elenco atual e comissão técnica (envie ?season=AAAA para outra temporada).',
});

export async function getSquad(id: string) {
  'use cache';
  cacheLife('hours');
  return orNull(api.squad(id));
}

// ─── evento ──────────────────────────────────────────────────────────────────────────────────────

export const eventRequest = (id: string, market?: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}',
  params: { id },
  query: market ? { market, ...LOCALE_QUERY } : LOCALE_QUERY,
  description:
    'Evento completo: participantes, placar, estado, importância (com detalhamento), relevância no mercado, clássico e o que está em jogo.',
});

/** Evento com a relevância no mercado (país ISO2) pedido. */
export async function getEvent(id: string, market?: string) {
  'use cache';
  cacheLife('minutes');
  return orNotFound(api.event(id, market ? { market } : {}));
}

export const h2hRequest = (id: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/h2h',
  params: { id },
  query: { limit: 10, ...LOCALE_QUERY },
  description: 'Histórico do confronto entre os dois participantes, com o resumo de vitórias e gols.',
});

export async function getH2h(id: string) {
  'use cache';
  cacheLife('hours');
  return orNull(api.eventH2h(id, { limit: 10 }));
}

export const eventContextRequest = (id: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/context',
  params: { id },
  query: LOCALE_QUERY,
  description: 'Cenário pré-jogo e resumo pós-jogo gerados a partir dos fatos, com fontes.',
  note: 'Exige o módulo live_intelligence.',
});

export async function getEventContext(id: string) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.eventContext(id));
}

export const whereToWatchRequest = (id: string, country: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/where-to-watch',
  params: { id },
  query: { country, ...LOCALE_QUERY },
  description: 'Onde assistir o evento num país: só opções confirmadas, com meio, confiança e fontes.',
  note: 'Exige o módulo where_to_watch e o país nos mercados do contrato.',
});

export async function getWhereToWatch(id: string, country: string) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.whereToWatch(id, country));
}

export const lineupsRequest = (id: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/events/{id}/lineups',
  params: { id },
  query: LOCALE_QUERY,
  description: 'Escalações, formação e técnico de cada time.',
});

export async function getLineups(id: string) {
  'use cache';
  cacheLife('minutes');
  return orNull(api.eventLineups(id));
}

// ─── pessoas e locais ────────────────────────────────────────────────────────────────────────────

export const personRequest = (id: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/people/{id}',
  params: { id },
  query: LOCALE_QUERY,
  description: 'Jogador, técnico ou piloto: dados pessoais, foto e times (elencos).',
});

export async function getPerson(id: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.person(id));
}

export const venueRequest = (id: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/venues/{id}',
  params: { id },
  query: LOCALE_QUERY,
  description: 'Estádio, circuito ou arena: cidade, capacidade, piso e foto.',
});

export async function getVenue(id: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.venue(id));
}

export const derbyRequest = (slug: string): ApiRequest => ({
  method: 'GET',
  route: '/v1/derbies/{slug}',
  params: { slug },
  query: LOCALE_QUERY,
  description: 'Clássico com história e retrospecto calculado dos jogos na base.',
  note: 'Exige o módulo semantic.',
});

export async function getDerby(slug: string) {
  'use cache';
  cacheLife('hours');
  return orNotFound(api.derby(slug));
}
