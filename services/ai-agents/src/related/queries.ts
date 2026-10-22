/**
 * Consultas da busca do YouTube montadas a partir dos fatos do core (docs/12 §5): times (rótulos
 * da base semântica), competição, autores de gol, apito. Nada aqui vem de IA.
 */
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

const PT_COUNTRIES = new Set(['BR', 'PT']);
const ES_COUNTRIES = new Set([
  'AR',
  'MX',
  'CO',
  'CL',
  'PE',
  'UY',
  'EC',
  'PY',
  'BO',
  'VE',
  'ES',
  'CR',
  'GT',
  'HN',
  'SV',
  'PA',
  'DO',
  'CU',
]);

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
  if (codes.some((c) => PT_COUNTRIES.has(c)) || !codes.some((c) => ES_COUNTRIES.has(c)))
    out.push({ language: 'pt', locale: 'pt-BR', regionCode: 'BR' });
  const es = codes.find((c) => ES_COUNTRIES.has(c) && c !== 'ES');
  if (codes.some((c) => ES_COUNTRIES.has(c)))
    out.push({
      language: 'es',
      locale: es === 'MX' ? 'es-MX' : es === 'CO' ? 'es-CO' : es === 'CL' ? 'es-CL' : 'es-AR',
      regionCode: es ?? 'MX',
    });
  return out;
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
