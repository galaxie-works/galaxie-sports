/**
 * Leituras do hipismo (`/v1/equestrian/*`, docs/13-hipismo.md) e os descritores do botão "Ver código".
 * Mesmo padrão de `api.ts`: cada fetcher é cacheado e tem ao lado o descritor da mesma requisição.
 */
import type {
  EqAthleteDetail,
  EqAthleteSummary,
  EqChampionship,
  EqCompetitionDetail,
  EqHorseDetail,
  EqOverview,
  EqResult,
} from '@galaxie/contracts';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';

import { apiLocale, type Locale } from '../i18n/config';
import { getDictionary } from '../i18n/dictionary';

import type { ApiQueryValue, ApiRequest } from './request';
import { GalaxieApiError, galaxieGet } from './server';

type Page<T> = { data: T[]; next_cursor: string | null };
type Query = Record<string, ApiQueryValue | undefined>;

const text = (locale: Locale) => getDictionary(locale).equestrian.requests;
const withLocale = (locale: Locale, query: Query = {}): Query => ({ locale: apiLocale(locale), ...query });

async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof GalaxieApiError && err.status === 404) notFound();
    throw err;
  }
}

const clean = (q: Query) =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<
    string,
    string | number | boolean
  >;

// ─── resumo ──────────────────────────────────────────────────────────────────────────────────────

export const equestrianOverviewRequest = (locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/equestrian/overview',
  query: withLocale(locale),
  description: text(locale).overview,
  note: text(locale).note,
});

export async function getEquestrianOverview(locale: Locale) {
  'use cache';
  cacheLife('hours');
  cacheTag('equestrian');
  return galaxieGet<EqOverview>('/v1/equestrian/overview', clean(withLocale(locale)));
}

// ─── atletas ─────────────────────────────────────────────────────────────────────────────────────

export interface AthleteFilters {
  q?: string;
  country?: string;
  coverage?: string;
  cursor?: string;
}

export const equestrianAthletesRequest = (locale: Locale, f: AthleteFilters = {}): ApiRequest => ({
  method: 'GET',
  route: '/v1/equestrian/athletes',
  query: withLocale(locale, { country: f.country, q: f.q, coverage: f.coverage, limit: 48 }),
  description: text(locale).athletes,
});

export async function getEquestrianAthletes(locale: Locale, f: AthleteFilters = {}) {
  'use cache';
  cacheLife('hours');
  cacheTag('equestrian');
  return galaxieGet<Page<EqAthleteSummary>>(
    '/v1/equestrian/athletes',
    clean(
      withLocale(locale, { country: f.country, q: f.q, coverage: f.coverage, cursor: f.cursor, limit: 48 }),
    ),
  );
}

export const equestrianAthleteRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/equestrian/athletes/{id}',
  params: { id },
  query: withLocale(locale),
  description: text(locale).athlete,
});

export async function getEquestrianAthlete(id: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  cacheTag('equestrian');
  return orNotFound(galaxieGet<EqAthleteDetail>(`/v1/equestrian/athletes/${id}`, clean(withLocale(locale))));
}

// ─── resultados ──────────────────────────────────────────────────────────────────────────────────

export interface ResultFilters {
  athlete?: string;
  horse?: string;
  competition?: string;
  from?: string;
  to?: string;
  podium?: string;
  cursor?: string;
  limit?: number;
}

const resultQuery = (f: ResultFilters): Query => ({
  athlete: f.athlete,
  horse: f.horse,
  competition: f.competition,
  from: f.from,
  to: f.to,
  podium: f.podium,
  limit: f.limit ?? 50,
});

export const equestrianResultsRequest = (locale: Locale, f: ResultFilters): ApiRequest => ({
  method: 'GET',
  route: '/v1/equestrian/results',
  query: withLocale(locale, resultQuery(f)),
  description: text(locale).results,
});

export async function getEquestrianResults(locale: Locale, f: ResultFilters) {
  'use cache';
  cacheLife('hours');
  cacheTag('equestrian');
  return galaxieGet<Page<EqResult>>(
    '/v1/equestrian/results',
    clean(withLocale(locale, { ...resultQuery(f), cursor: f.cursor })),
  );
}

// ─── cavalo, prova e campeonato ──────────────────────────────────────────────────────────────────

export const equestrianHorseRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/equestrian/horses/{id}',
  params: { id },
  query: withLocale(locale),
  description: text(locale).horse,
});

export async function getEquestrianHorse(id: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  cacheTag('equestrian');
  return orNotFound(galaxieGet<EqHorseDetail>(`/v1/equestrian/horses/${id}`, clean(withLocale(locale))));
}

export const equestrianCompetitionRequest = (id: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/equestrian/competitions/{id}',
  params: { id },
  query: withLocale(locale),
  description: text(locale).competition,
});

export async function getEquestrianCompetition(id: string, locale: Locale) {
  'use cache';
  cacheLife('hours');
  cacheTag('equestrian');
  return orNotFound(
    galaxieGet<EqCompetitionDetail>(`/v1/equestrian/competitions/${id}`, clean(withLocale(locale))),
  );
}

export const equestrianChampionshipRequest = (key: string, locale: Locale): ApiRequest => ({
  method: 'GET',
  route: '/v1/equestrian/championships/{key}',
  params: { key },
  query: withLocale(locale),
  description: text(locale).championship,
});

export async function getEquestrianChampionship(key: string, locale: Locale) {
  'use cache';
  cacheLife('days');
  cacheTag('equestrian');
  return orNotFound(
    galaxieGet<EqChampionship>(`/v1/equestrian/championships/${key}`, clean(withLocale(locale))),
  );
}
