/**
 * Prioridade e tempo do Conteúdo relacionado: em que ordem a fila atende os jogos (grupo, relevância no
 * mercado × peso do mercado × rendimento da competição), quando ler os canais e buscar de novo (logo depois
 * do apito e uma segunda vez quando os melhores momentos já saíram), quantos vídeos guardar e de que país é
 * cada vídeo. O orçamento da cota (dois baldes, reserva por agenda) fica em `budget.ts`. Tudo em código.
 */
import type { RelatedStatus } from '@galaxie/db';
import { DEFAULT_MARKET_WEIGHTS, parseMarketWeights, type QueueGroup } from './budget.js';
import { languageOfCountry, type RelatedLanguage } from './queries.js';

export const DEFAULT_RELATED_MARKETS = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'];
export const DEFAULT_MIN_RELEVANCE = 50;
/** Buscas por jogo no total (todas as execuções). */
export const DEFAULT_MAX_SEARCHES_PER_EVENT = 4;
/** Buscas por jogo numa execução (a primeira sai no apito, a segunda quando os melhores momentos saíram). */
export const DEFAULT_MAX_SEARCHES_PER_RUN = 2;
export const DEFAULT_MAX_VIDEOS = 12;
export const DEFAULT_LOOKBACK_HOURS = 24;
export const DEFAULT_SECOND_SEARCH_MINUTES = 30;
/** Vídeos aproveitáveis de canal oficial/detentor que dispensam a busca do jogo. */
export const DEFAULT_CHANNEL_ENOUGH = 4;
/** Releitura dos canais conhecidos de um jogo entre as buscas completas. */
export const DEFAULT_CHANNEL_REFRESH_MINUTES = 60;
/** Revalidação (videos.list dos guardados) no máximo a cada N minutos por jogo. */
export const DEFAULT_REVALIDATE_MINUTES = 120;
/** Teto da reserva de buscas para os jogos que ainda vão acontecer no dia de cota (% do balde de busca). */
export const DEFAULT_RESERVE_MAX_PERCENT = 60;
/**
 * Primeira busca só a partir de N minutos depois do início (~25 min depois do apito final): no apito a busca
 * ainda não acha os melhores momentos; os canais oficiais cobrem os primeiros minutos.
 */
export const DEFAULT_SEARCH_AFTER_KICKOFF_MINUTES = 140;

export interface RelatedPolicy {
  markets: string[];
  /** Relevância mínima (no mercado mais relevante) para o jogo entrar na fila. */
  minRelevance: number;
  /** Peso de cada mercado na prioridade (BR 1; os demais menores). */
  marketWeights: Record<string, number>;
  /** Buscas por jogo no total (todas as execuções). */
  maxSearchesPerEvent: number;
  /** Buscas por jogo numa execução. */
  maxSearchesPerRun: number;
  /** Vídeos publicados por jogo e idioma; o excedente fica guardado como `pending`. */
  maxVideos: number;
  lookbackHours: number;
  /** Minutos depois da primeira busca para a segunda (os melhores momentos saem 10–30 min após o apito). */
  secondSearchMinutes: number;
  /** Vídeos aproveitáveis dos canais conhecidos que dispensam a busca. */
  channelEnough: number;
  channelRefreshMinutes: number;
  revalidateMinutes: number;
  /** Teto da reserva por agenda (% do balde de busca); 0 desliga a reserva. */
  reserveMaxPercent: number;
  /** Busca só a partir de N minutos depois do início do jogo. */
  searchAfterKickoffMinutes: number;
  /** Lê os uploads dos canais conhecidos antes de buscar (padrão; desligado só na simulação do modelo antigo). */
  channelsFirst: boolean;
  /** Jogos fora dos mercados e de competição com rendimento zero recorrente vão para o fim da fila (padrão). */
  foreignLast: boolean;
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
    marketWeights: parseMarketWeights(env.RELATED_MARKET_WEIGHTS) ?? { ...DEFAULT_MARKET_WEIGHTS },
    maxSearchesPerEvent: int(env.RELATED_MAX_SEARCHES_PER_EVENT, DEFAULT_MAX_SEARCHES_PER_EVENT, 0),
    maxSearchesPerRun: int(env.RELATED_MAX_SEARCHES_PER_RUN, DEFAULT_MAX_SEARCHES_PER_RUN, 0),
    maxVideos: int(env.RELATED_MAX_VIDEOS, DEFAULT_MAX_VIDEOS, 1),
    lookbackHours: int(env.RELATED_LOOKBACK_HOURS, DEFAULT_LOOKBACK_HOURS, 1),
    secondSearchMinutes: int(env.RELATED_SECOND_SEARCH_MINUTES, DEFAULT_SECOND_SEARCH_MINUTES, 0),
    channelEnough: int(env.RELATED_CHANNEL_ENOUGH, DEFAULT_CHANNEL_ENOUGH, 1),
    channelRefreshMinutes: int(env.RELATED_CHANNEL_REFRESH_MINUTES, DEFAULT_CHANNEL_REFRESH_MINUTES, 0),
    revalidateMinutes: int(env.RELATED_REVALIDATE_MINUTES, DEFAULT_REVALIDATE_MINUTES, 0),
    reserveMaxPercent: Math.min(90, int(env.RELATED_RESERVE_MAX_PERCENT, DEFAULT_RESERVE_MAX_PERCENT)),
    searchAfterKickoffMinutes: int(
      env.RELATED_SEARCH_AFTER_KICKOFF_MINUTES,
      DEFAULT_SEARCH_AFTER_KICKOFF_MINUTES,
    ),
    channelsFirst: true,
    foreignLast: true,
  };
}

export interface RankableCandidate {
  id: string;
  startsAt: Date;
  /** Maior relevância entre os mercados ativos. */
  relevance: number;
  /** Ainda não teve busca completa (jogo que acabou de terminar). */
  firstSearchPending: boolean;
  /** Prioridade: relevância × peso do mercado × rendimento da competição (padrão: a relevância). */
  score?: number;
  /** 0 = mercado ativo · 1 = fora dos mercados (Europa) · 2 = competição de rendimento zero recorrente. */
  group?: QueueGroup;
}

/**
 * Ordem da fila: grupo (mercados ativos → fora dos mercados → rendimento zero recorrente); dentro dele, quem
 * ainda não teve a primeira busca vem antes (os vídeos têm de aparecer logo após o apito), depois a prioridade
 * (relevância × peso do mercado × rendimento) e, no empate, o jogo mais recente.
 */
export function rankRelatedCandidates<T extends RankableCandidate>(
  cands: readonly T[],
  minRelevance: number,
): T[] {
  return cands
    .filter((c) => c.relevance >= minRelevance)
    .sort(
      (a, b) =>
        (a.group ?? 0) - (b.group ?? 0) ||
        Number(b.firstSearchPending) - Number(a.firstSearchPending) ||
        (b.score ?? b.relevance) - (a.score ?? a.relevance) ||
        b.startsAt.getTime() - a.startsAt.getTime() ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Busca completa agora? A primeira sempre; a segunda `secondSearchMinutes` depois da primeira (pega os
 * melhores momentos publicados mais tarde); depois, uma a cada `researchMs`. No meio, canais ou revalidação.
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

export type RelatedMode = 'full' | 'channels' | 'revalidate';

/**
 * O que fazer com o jogo nesta execução do cron (a cada 3 min): busca completa quando devida e com consulta
 * disponível; senão reler os canais conhecidos (`channelRefreshMs`), senão revalidar os guardados
 * (`revalidateMs`); senão nada (null) — a execução sem trabalho não chama o YouTube.
 */
export function nextMode(input: {
  fullDue: boolean;
  /** Consultas que o jogo pode gastar agora (cota, reserva, teto). */
  searchAllowance: number;
  hasChannels: boolean;
  hasAlive: boolean;
  lastChannels: Date | null;
  lastAny: Date | null;
  now: Date;
  channelRefreshMs: number;
  revalidateMs: number;
}): RelatedMode | null {
  const since = (d: Date | null) => (d ? input.now.getTime() - d.getTime() : Infinity);
  if (input.fullDue && input.searchAllowance > 0) return 'full';
  if (input.hasChannels && since(input.lastChannels) >= input.channelRefreshMs) return 'channels';
  if (input.hasAlive && since(input.lastAny) >= input.revalidateMs) return 'revalidate';
  return null;
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
