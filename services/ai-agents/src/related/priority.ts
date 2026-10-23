/**
 * Prioridade e orçamento do Conteúdo relacionado: quais jogos a cota do YouTube atende primeiro
 * (relevância nos mercados ativos, não o tier da competição), quando buscar de novo (logo depois do
 * apito e uma segunda vez quando os melhores momentos já saíram), quantos vídeos guardar e de que
 * país é cada vídeo. Tudo em código — sem chamadas.
 */
import type { RelatedStatus } from '@galaxie/db';
import { languageOfCountry, type RelatedLanguage } from './queries.js';

export const DEFAULT_RELATED_MARKETS = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'];
export const DEFAULT_MIN_RELEVANCE = 50;
export const DEFAULT_HIGH_RELEVANCE = 85;
export const DEFAULT_HIGH_RESERVE_PERCENT = 30;
export const DEFAULT_MAX_SEARCHES_PER_EVENT = 4;
export const DEFAULT_MAX_VIDEOS = 12;
export const DEFAULT_LOOKBACK_HOURS = 24;
export const DEFAULT_SECOND_SEARCH_MINUTES = 30;
/** Buscas seguidas sem nenhum resultado antes de desistir do jogo nesta execução. */
export const EMPTY_SEARCHES_TO_STOP = 2;

export interface RelatedPolicy {
  markets: string[];
  /** Relevância mínima (no mercado mais relevante) para o jogo entrar na fila. */
  minRelevance: number;
  /** A partir desta relevância o jogo usa a fatia reservada da cota. */
  highRelevance: number;
  /** Parte da cota útil do dia guardada para os jogos de relevância alta. */
  highReservePercent: number;
  maxSearchesPerEvent: number;
  /** Vídeos publicados por jogo e idioma; o excedente fica guardado como `pending`. */
  maxVideos: number;
  lookbackHours: number;
  /** Minutos depois da primeira busca para a segunda (os melhores momentos saem 10–30 min após o apito). */
  secondSearchMinutes: number;
}

const int = (raw: string | undefined, fallback: number, min = 0): number => {
  const n = raw?.trim() ? Number(raw.trim()) : NaN;
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
};

/** Mercados: RELATED_MARKETS, senão WTW_MARKETS, senão os 8 da América Latina. */
export function relatedPolicyFromEnv(env: Record<string, string | undefined> = process.env): RelatedPolicy {
  const raw = env.RELATED_MARKETS?.trim() || env.WTW_MARKETS?.trim();
  const markets = raw
    ? [
        ...new Set(
          raw
            .split(/[,\s]+/)
            .map((m) => m.trim().toUpperCase())
            .filter((m) => /^[A-Z]{2}$/.test(m)),
        ),
      ]
    : DEFAULT_RELATED_MARKETS;
  return {
    markets: markets.length ? markets : DEFAULT_RELATED_MARKETS,
    minRelevance: Math.min(100, int(env.RELATED_MIN_RELEVANCE, DEFAULT_MIN_RELEVANCE)),
    highRelevance: Math.min(100, int(env.RELATED_HIGH_RELEVANCE, DEFAULT_HIGH_RELEVANCE)),
    highReservePercent: Math.min(90, int(env.RELATED_HIGH_RESERVE_PERCENT, DEFAULT_HIGH_RESERVE_PERCENT)),
    maxSearchesPerEvent: int(env.RELATED_MAX_SEARCHES_PER_EVENT, DEFAULT_MAX_SEARCHES_PER_EVENT, 1),
    maxVideos: int(env.RELATED_MAX_VIDEOS, DEFAULT_MAX_VIDEOS, 1),
    lookbackHours: int(env.RELATED_LOOKBACK_HOURS, DEFAULT_LOOKBACK_HOURS, 1),
    secondSearchMinutes: int(env.RELATED_SECOND_SEARCH_MINUTES, DEFAULT_SECOND_SEARCH_MINUTES, 0),
  };
}

export interface RankableCandidate {
  id: string;
  startsAt: Date;
  /** Maior relevância entre os mercados ativos. */
  relevance: number;
  /** Ainda não teve busca completa (jogo que acabou de terminar). */
  firstSearchPending: boolean;
}

/**
 * Ordem da fila: quem ainda não teve a primeira busca vem antes (os vídeos têm de aparecer logo após o
 * apito); dentro de cada grupo, a relevância nos mercados e, no empate, o jogo mais recente.
 */
export function rankRelatedCandidates<T extends RankableCandidate>(
  cands: readonly T[],
  minRelevance: number,
): T[] {
  return cands
    .filter((c) => c.relevance >= minRelevance)
    .sort(
      (a, b) =>
        Number(b.firstSearchPending) - Number(a.firstSearchPending) ||
        b.relevance - a.relevance ||
        b.startsAt.getTime() - a.startsAt.getTime() ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Busca completa agora? A primeira sempre; a segunda `secondSearchMinutes` depois da primeira (pega os
 * melhores momentos publicados mais tarde); depois, uma a cada `researchMs`. No meio, só revalida.
 */
export function fullSearchDue(input: {
  fullRuns: number;
  lastFull: Date | null;
  now: Date;
  researchMs: number;
  secondSearchMs: number;
}): boolean {
  if (!input.lastFull || input.fullRuns === 0) return true;
  const since = input.now.getTime() - input.lastFull.getTime();
  if (input.fullRuns === 1 && input.secondSearchMs > 0) return since >= input.secondSearchMs;
  return since >= input.researchMs;
}

/** Saldo de unidades que o jogo pode gastar: os de relevância baixa não tocam a fatia reservada. */
export function availableUnits(input: {
  quotaLimit: number;
  used: number;
  relevance: number;
  policy: Pick<RelatedPolicy, 'highRelevance' | 'highReservePercent'>;
}): number {
  const reserved =
    input.relevance >= input.policy.highRelevance
      ? 0
      : Math.floor((input.quotaLimit * input.policy.highReservePercent) / 100);
  return input.quotaLimit - reserved - input.used;
}

/**
 * Idioma e país do vídeo no formato `es-AR`/`pt-BR`: o país do canal quando ele fala o idioma do vídeo
 * (canal argentino em espanhol → es-AR); senão o país da busca que achou o vídeo; sem país, só o idioma.
 */
export function videoLocale(input: {
  language: string | null;
  channelCountry?: string | null;
  queryRegion?: string | null;
}): string | null {
  const lang = input.language?.slice(0, 2).toLowerCase() ?? null;
  if (!lang) {
    const fromChannel = input.channelCountry ? languageOfCountry(input.channelCountry) : null;
    return fromChannel ? `${fromChannel}-${input.channelCountry!.toUpperCase()}` : null;
  }
  for (const c of [input.channelCountry, input.queryRegion]) {
    if (c && languageOfCountry(c) === (lang as RelatedLanguage)) return `${lang}-${c.toUpperCase()}`;
  }
  return lang;
}

/**
 * Limite de vídeos por jogo e idioma: publica os `max` de maior `rankScore` de cada idioma; o resto
 * fica `pending` com a marca `over_limit` (fora da vitrine, mas sem nova busca para reachar).
 */
export function capPublished<
  T extends { status: RelatedStatus; rankScore: number; language: string | null; flags: string[] },
>(items: T[], max: number): T[] {
  const byLang = new Map<string, T[]>();
  for (const it of items) {
    if (it.status !== 'published') continue;
    const key = it.language?.slice(0, 2) ?? '?';
    byLang.set(key, [...(byLang.get(key) ?? []), it]);
  }
  for (const list of byLang.values()) {
    list.sort((a, b) => b.rankScore - a.rankScore);
    for (const it of list.slice(max)) {
      it.status = 'pending';
      if (!it.flags.includes('over_limit')) it.flags.push('over_limit');
    }
  }
  return items;
}
