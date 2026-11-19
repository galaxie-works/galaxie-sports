/**
 * Consultas da busca do YouTube montadas a partir dos fatos do core (docs/12 §5): times (rótulos
 * da base semântica), competição, autores de gol, apito. Nada aqui vem de IA.
 */
import { countryLocale, iberianLanguage } from '@galaxie/geo';
import { competitionName, teamName, type EventCore } from '../context/event-core.js';
import type { AgentLocale } from '../guardrails/index.js';
import type { SearchParams } from './youtube.js';

export type RelatedLanguage = 'pt' | 'es';
export type QueryLabel = 'highlights' | 'shorts' | 'goals' | 'postgame';

export interface RelatedQuery {
  label: QueryLabel;
  language: RelatedLanguage;
  params: SearchParams;
}

export interface LanguagePlan {
  language: RelatedLanguage;
  locale: AgentLocale;
  regionCode: string;
}

/**
 * Idiomas das consultas pelo país dos times: `pt` se algum time é de país lusófono, `es` se algum é
 * de país hispânico; nenhum dos dois (ex.: jogo europeu) → `pt`, o mercado principal.
 */
export function languagesFor(teamCountries: readonly (string | null)[]): LanguagePlan[] {
  const out: LanguagePlan[] = [];
  const codes = teamCountries.filter((c): c is string => !!c).map((c) => c.toUpperCase());
  const isPt = (c: string) => languageOfCountry(c) === 'pt';
  const isEs = (c: string) => languageOfCountry(c) === 'es';
  if (codes.some(isPt) || !codes.some(isEs)) out.push({ language: 'pt', locale: 'pt-BR', regionCode: 'BR' });
  const es = codes.find((c) => isEs(c) && c !== 'ES');
  if (codes.some(isEs)) out.push({ language: 'es', locale: spanishLocale(es), regionCode: es ?? 'MX' });
  return out;
}

/** Idioma dos vídeos de um país (pt para BR/PT, es para os hispânicos); null fora dos dois. */
export function languageOfCountry(country: string): RelatedLanguage | null {
  return iberianLanguage(country);
}

/** Locale do espanhol do país (voz própria nos mercados da API, senão es-AR), pelo packages/geo. */
function spanishLocale(country: string | undefined): AgentLocale {
  const locale = country ? countryLocale(country) : null;
  return locale?.startsWith('es-') ? (locale as AgentLocale) : 'es-AR';
}

/**
 * Idiomas das consultas pelos mercados em que o jogo é relevante (relevância ≥ `min`), do mais
 * relevante para o menos: `regionCode` é o mercado mais relevante daquele idioma. Sem mercado
 * relevante, null (quem chama cai no país dos times).
 */
export function languagesForMarkets(
  relevance: Readonly<Record<string, number>>,
  min: number,
): LanguagePlan[] | null {
  const ranked = Object.entries(relevance)
    .filter(([, r]) => r >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out: LanguagePlan[] = [];
  for (const [market] of ranked) {
    const language = languageOfCountry(market);
    if (!language || out.some((p) => p.language === language)) continue;
    out.push(
      language === 'pt'
        ? { language, locale: 'pt-BR', regionCode: market }
        : { language, locale: spanishLocale(market), regionCode: market },
    );
  }
  return out.length ? out : null;
}

/**
 * Teto de buscas por jogo: alterna os idiomas na ordem dos rótulos (highlights de todos, depois shorts…),
 * para o corte nunca deixar um mercado sem o resumo do jogo.
 */
export function capQueries(queries: readonly RelatedQuery[], max: number): RelatedQuery[] {
  if (max <= 0) return [];
  const ordered = ORDER.flatMap((label) => queries.filter((q) => q.label === label));
  return ordered.slice(0, max);
}

export interface QueryFacts {
  core: EventCore;
  /** Autores de gol do core (sem repetição, na ordem da timeline). */
  scorers: string[];
  languages: LanguagePlan[];
  /** Janela da busca depois do apito (padrão 7 dias). */
  windowDays?: number;
  /** Consultas por idioma, na ordem highlights → shorts → goals → postgame (padrão 4). */
  maxPerLanguage?: number;
}

const ORDER: QueryLabel[] = ['highlights', 'shorts', 'goals', 'postgame'];

/** Último sobrenome curto do autor ("Raphael Veiga" → "Veiga"): o título costuma usar só ele. */
function shortScorer(name: string): string {
  const parts = name.replace(/\./g, ' ').trim().split(/\s+/);
  return parts.length > 1 ? parts.at(-1)! : parts[0]!;
}

export function buildRelatedQueries(facts: QueryFacts): RelatedQuery[] {
  const { core } = facts;
  const after = core.startsAt;
  const before = new Date(after.getTime() + (facts.windowDays ?? 7) * 86_400_000);
  const max = facts.maxPerLanguage ?? 4;
  const out: RelatedQuery[] = [];
  for (const lp of facts.languages) {
    const home = teamName(core.home, lp.locale);
    const away = teamName(core.away, lp.locale);
    const comp = competitionName(core, lp.locale)?.replace(/^CONMEBOL\s+/i, '') ?? '';
    const pt = lp.language === 'pt';
    const scorers = [...new Set(facts.scorers.map(shortScorer))].slice(0, 3);
    const text: Record<QueryLabel, string | null> = {
      highlights: pt ? `${home} x ${away} melhores momentos ${comp}` : `${home} vs ${away} resumen ${comp}`,
      shorts: `${home} ${away} #shorts`,
      goals: scorers.length ? `${home} ${away} gol ${scorers.join('|')}` : null,
      postgame: pt
        ? `${home} ${away} coletiva|bastidores|torcida|análise`
        : `${home} ${away} conferencia|vestuario|hinchada|análisis`,
    };
    for (const label of ORDER) {
      const q = text[label];
      if (!q || out.filter((x) => x.language === lp.language).length >= max) continue;
      out.push({
        label,
        language: lp.language,
        params: {
          q: q.replace(/\s+/g, ' ').trim(),
          publishedAfter: after,
          publishedBefore: before,
          videoDuration: label === 'shorts' ? 'short' : 'any',
          relevanceLanguage: lp.language,
          regionCode: lp.regionCode,
          order: 'relevance',
          maxResults: 25,
        },
      });
    }
  }
  return out;
}
