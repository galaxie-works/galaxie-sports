/**
 * Escolhas do resumo da home "Explorar" (docs/05 §3.1.2), em funções puras: competições em destaque, liga principal
 * do país, jogos e ao vivo por país e o jogo de maior relevância no mercado. Sem textos nem idioma: a relevância sai
 * com os códigos e os pontos dos motivos, e a API escreve os textos no idioma da requisição.
 */
import type { ExploreCompetition, RelevanceReasonCode } from '@galaxie/contracts';
import type { MarketAudience } from '@galaxie/geo';
import { audienceOf, marketBonus } from './market.js';

/** Competições em destaque por esporte e clubes em destaque por país. */
export const TOP_COMPETITIONS = 4;
export const TOP_TEAMS = 5;
/** A liga principal (e os clubes em destaque) do país vêm deste esporte. */
export const MAIN_SPORT = 'football';
/** Jogos que não contam como "próximos". */
const NOT_UPCOMING = new Set(['postponed', 'cancelled', 'abandoned', 'finished']);
/** Jogos anunciados (provisórios) de cada país: até quantos e com quanta antecedência. */
export const ANNOUNCED_PER_COUNTRY = 2;
export const ANNOUNCED_DAYS = 90;

export interface CatalogItem {
  id: string;
  sport: string;
  slug: string;
  type: ExploreCompetition['type'];
  tier: number;
  prestige: number;
  countryCode: string | null;
  /** Jogos nos últimos 12 meses (e no mês seguinte). */
  recent: number;
}

/**
 * Competições em destaque de um esporte: as que tiveram jogos recentes primeiro (uma Euro sem edição no
 * ano não ocupa a vitrine), depois menor tier, maior prestígio e mais jogos.
 */
export function rankTopCompetitions<T extends CatalogItem>(items: T[], limit = TOP_COMPETITIONS): T[] {
  return [...items]
    .sort(
      (a, b) =>
        Number(b.recent > 0) - Number(a.recent > 0) ||
        a.tier - b.tier ||
        b.prestige - a.prestige ||
        b.recent - a.recent ||
        a.slug.localeCompare(b.slug),
    )
    .slice(0, limit);
}

/**
 * Liga principal do país: só ligas (não copas), menor tier, a ordem de `featured` (config/geo) e, fora
 * dela, a com mais jogos recentes.
 */
export function pickMainCompetition<T extends CatalogItem>(
  items: T[],
  featuredOrder: (sport: string, slug: string) => number | null,
): T | null {
  const order = (c: T) => featuredOrder(c.sport, c.slug) ?? Number.MAX_SAFE_INTEGER;
  const leagues = items.filter((c) => c.type === 'league');
  return (
    [...leagues].sort(
      (a, b) => a.tier - b.tier || order(a) - order(b) || b.recent - a.recent || a.slug.localeCompare(b.slug),
    )[0] ?? null
  );
}

export interface WindowEvent {
  id: string;
  sport: string;
  status: string;
  startsAt: Date;
  importance: number;
  /** Em andamento de fato (status de jogo e dado fresco, como em /v1/events/live). */
  live: boolean;
  competition: {
    sport: string;
    slug: string;
    countryCode: string | null;
    /** Para as facetas da agenda (o resumo não usa). */
    id?: string;
    /** Nome do catálogo; a agenda troca pelo nome no idioma da requisição. */
    name?: string;
    labels?: Record<string, string> | null;
  } | null;
  participantIds: string[];
  participantCountries: (string | null)[];
}

/** O jogo envolve o país? (competição do país ou participante do país, como `/v1/events?country=`). */
export function involves(e: WindowEvent, code: string): boolean {
  return e.competition?.countryCode === code || e.participantCountries.includes(code);
}

export function isUpcoming(e: WindowEvent, from: Date, to: Date): boolean {
  return !NOT_UPCOMING.has(e.status) && e.startsAt >= from && e.startsAt < to;
}

/** Relevância de um jogo num mercado (docs/06 §3.2), sem os textos dos motivos (a API os escreve no idioma pedido). */
export interface MarketRelevance {
  market: string;
  score: number;
  bonus: number;
  reasons: RelevanceReasonCode[];
  details: { code: RelevanceReasonCode; points: number }[];
}

/** Um jogo escolhido para o card do país: o suficiente para comparar, juntar esportes e escrever a resposta. */
export interface CountryCandidate {
  id: string;
  /** ISO 8601 em UTC (`toISOString`): a ordem do texto é a ordem do tempo. */
  startsAt: string;
  competition: { sport: string; slug: string } | null;
  relevance: MarketRelevance;
}

export interface HighlightCandidate extends CountryCandidate {
  /** Desempates: quantos clubes em destaque do país estão em campo e se é jogo da liga principal (0 ou 1). */
  appeal: [number, number];
}

export interface CountryActivity {
  upcoming: number;
  live: number;
  /** Próximo jogo de maior relevância no mercado do país. */
  highlight: HighlightCandidate | null;
}

/** Desempate do destaque: clubes em destaque do país e a liga principal. */
export interface HighlightPreference {
  teams: ReadonlySet<string>;
  main: { sport: string; slug: string } | null;
}

/**
 * Ordem do destaque (o menor ganha): maior relevância no mercado; como ela empata muito (toda rodada da liga soma o
 * mesmo bônus), desempata por clubes em destaque envolvidos, jogo da liga principal, o mais cedo e, por fim, o id.
 * É uma ordem total: o melhor de cada esporte, comparado de novo, dá o melhor entre todos.
 */
export function compareHighlight(a: HighlightCandidate, b: HighlightCandidate): number {
  return (
    b.relevance.score - a.relevance.score ||
    b.appeal[0] - a.appeal[0] ||
    b.appeal[1] - a.appeal[1] ||
    compareStart(a, b) ||
    a.id.localeCompare(b.id)
  );
}

function compareStart(a: CountryCandidate, b: CountryCandidate): number {
  return a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0;
}

/**
 * Jogos, ao vivo e o destaque de um país a partir dos jogos da janela. O destaque é o de maior relevância
 * no mercado (bônus de docs/06 §3.2), com os desempates de `compareHighlight`. O bônus de semifinal (outro lado
 * da chave) fica de fora: o resumo não carrega as chaves.
 */
export function countryActivity(
  events: WindowEvent[],
  code: string,
  window: { from: Date; to: Date },
  continental: ReadonlySet<string>,
  prefer: HighlightPreference = { teams: new Set(), main: null },
  audience?: MarketAudience | null,
): CountryActivity {
  let upcoming = 0;
  let live = 0;
  let best: HighlightCandidate | null = null;
  for (const e of events) {
    if (!involves(e, code)) continue;
    if (e.live) live += 1;
    if (!isUpcoming(e, window.from, window.to)) continue;
    upcoming += 1;
    const candidate: HighlightCandidate = {
      ...candidateOf(e, code, continental, audience),
      appeal: [
        e.participantIds.filter((id) => prefer.teams.has(id)).length,
        Number(
          !!prefer.main &&
            e.competition?.sport === prefer.main.sport &&
            e.competition.slug === prefer.main.slug,
        ),
      ],
    };
    if (!best || compareHighlight(candidate, best) < 0) best = candidate;
  }
  return { upcoming, live, highlight: best };
}

function candidateOf(
  e: WindowEvent,
  code: string,
  continental: ReadonlySet<string>,
  audience: MarketAudience | null | undefined,
): CountryCandidate {
  return {
    id: e.id,
    startsAt: e.startsAt.toISOString(),
    competition: e.competition ? { sport: e.competition.sport, slug: e.competition.slug } : null,
    relevance: marketRelevance(e, code, continental, audience),
  };
}

/** Relevância do jogo no mercado do país (bônus de docs/06 §3.2 e audiência, sem o da outra semifinal). */
export function marketRelevance(
  e: Pick<WindowEvent, 'participantCountries' | 'competition' | 'importance'>,
  code: string,
  continental: ReadonlySet<string>,
  audience?: MarketAudience | null,
): MarketRelevance {
  const { bonus, reasons, details } = marketBonus(
    code,
    { participantCountries: e.participantCountries, competition: e.competition },
    continental,
    audienceOf(audience, code, e.competition, e.importance),
  );
  return {
    market: code,
    score: Math.min(100, e.importance + bonus),
    bonus,
    reasons,
    details: details.map((d) => ({ code: d.code, points: d.points })),
  };
}

/**
 * Jogos anunciados (provisórios: oficiais, ainda sem o fornecedor) que envolvem o país, do mais cedo ao mais tarde.
 * Guarda um a mais que o card mostra: o destaque da janela sai da lista em `pickAnnounced`, e ele pode estar aqui.
 */
export function announcedCandidates(
  provisional: WindowEvent[],
  code: string,
  now: Date,
  continental: ReadonlySet<string>,
  audience?: MarketAudience | null,
  limit = ANNOUNCED_PER_COUNTRY + 1,
): CountryCandidate[] {
  return provisional
    .filter((e) => involves(e, code) && !NOT_UPCOMING.has(e.status) && e.startsAt >= now)
    .sort((a, b) => +a.startsAt - +b.startsAt || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((e) => candidateOf(e, code, continental, audience));
}

/** Os anunciados do card do país: sem o destaque da janela (que já aparece no card), do mais cedo ao mais tarde. */
export function pickAnnounced(
  candidates: CountryCandidate[],
  exclude: string | null,
  limit = ANNOUNCED_PER_COUNTRY,
): CountryCandidate[] {
  return candidates
    .filter((c) => c.id !== exclude)
    .sort((a, b) => compareStart(a, b) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
