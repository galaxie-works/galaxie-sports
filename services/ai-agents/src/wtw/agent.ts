/**
 * Agente Onde Assistir (issue #48, docs/07 §2.2): LLM nível `research` com busca na web restrita à
 * allowlist conjunta dos países e saída em JSON Schema estrito. Dois pedidos, ambos cobrindo vários
 * mercados numa chamada: direitos por temporada (nível 1) e alocação por rodada (nível 2). Só PROPÕE
 * — quem decide o que publicar é o validador determinístico (@galaxie/where-to-watch).
 */
import type { Candidate, CountryDirectory, RightsCandidate } from '@galaxie/where-to-watch';
import { sanitizeText } from '../llm/hygiene.js';
import type { LlmCitation, LlmClient, LlmResult } from '../llm/types.js';
import type { EventInfo } from './event-info.js';
import { jointAllowedDomains } from './groups.js';
import {
  buildAllocationSystemPrompt,
  buildAllocationUserPrompt,
  buildRightsSystemPrompt,
  buildRightsUserPrompt,
  type AllocationMarket,
} from './prompt.js';
import {
  WTW_ALLOCATION_SCHEMA,
  WTW_ALLOCATION_SCHEMA_NAME,
  WTW_MAX_EVIDENCE,
  WTW_MAX_OPTIONS,
  WTW_RIGHTS_SCHEMA,
  WTW_RIGHTS_SCHEMA_NAME,
  type WtwAllocationOutput,
  type WtwOutputEvidence,
  type WtwRightsOutput,
} from './schema.js';

export type LlmMeta = Omit<LlmResult<unknown>, 'data'>;

export interface AllocationInput {
  competition: { slug: string; name: string };
  round: string;
  events: EventInfo[];
  markets: AllocationMarket[];
}

export interface AllocationResult {
  /** evento → país → candidatas propostas. */
  byEvent: Map<string, Map<string, Candidate[]>>;
  citations: LlmCitation[];
  notes: string | null;
  result: LlmMeta;
  /** Linhas fora da lista (jogo/país desconhecido). */
  ignored: number;
}

export interface RightsResearchInput {
  competition: { slug: string; name: string };
  season: number;
  directories: CountryDirectory[];
}

export interface RightsResearchResult {
  markets: RightsCandidate[];
  notes: string | null;
  citations: LlmCitation[];
  result: LlmMeta;
}

/**
 * `purpose` segue `<agente>:...`; com um único país, termina em `:<ISO2>` (localização da busca).
 */
export const allocationPurpose = (competition: string, round: string, countries: string[]) =>
  `wtw:alloc:${competition}:${round.replace(/\s+/g, '_')}${countries.length === 1 ? `:${countries[0]}` : ''}`;
export const rightsPurpose = (competition: string, season: number, countries: string[]) =>
  `wtw:rights:${competition}:${season}${countries.length === 1 ? `:${countries[0]}` : ''}`;

const toEvidence = (e: WtwOutputEvidence) => ({
  url: e.url.trim(),
  excerpt: sanitizeText(e.excerpt, 400),
  publishedAt: e.published_at && Number.isFinite(Date.parse(e.published_at)) ? e.published_at : null,
  stance: e.stance,
});

export class WhereToWatchAgent {
  constructor(
    private readonly llm: LlmClient,
    private readonly options: { maxOutputTokens?: number } = {},
  ) {}

  /** Nível 2: uma chamada para a rodada inteira, em todos os mercados que precisam de alocação. */
  async allocate(input: AllocationInput): Promise<AllocationResult> {
    const codes = input.events.map((info, i) => ({ code: `J${i + 1}`, info }));
    const byCode = new Map(codes.map((c) => [c.code, c.info]));
    const holders = new Map<string, string[]>(input.markets.map((m) => [m.directory.country, m.holders]));
    // com lista de detentores, só eles (e os já garantidos) valem: o validador rebaixa o não detentor
    // só em 0,2 e uma fonte do organizador ainda o publicaria
    const markets = new Map(input.markets.map((m) => [m.directory.country as string, m]));
    const isHolder = (country: string, name: string, channel: string | null) => {
      const m = markets.get(country)!;
      if (!m.holders.length) return true;
      const r = m.directory.resolve(name.trim()) ?? (channel ? m.directory.resolve(channel.trim()) : null);
      return !!r && (m.holders.includes(r.entry.id) || m.known.includes(r.entry.id));
    };
    const countries: string[] = input.markets.map((m) => m.directory.country);
    const result = await this.llm.generateJson<WtwAllocationOutput>({
      tier: 'research',
      system: buildAllocationSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildAllocationUserPrompt({
            competition: input.competition,
            round: input.round,
            matches: codes,
            markets: input.markets,
          }),
        },
      ],
      schema: WTW_ALLOCATION_SCHEMA,
      schemaName: WTW_ALLOCATION_SCHEMA_NAME,
      webSearch: true,
      allowedDomains: jointAllowedDomains(
        input.markets.map((m) => m.directory),
        { broadcasterIds: new Map([...holders].filter(([, ids]) => ids.length > 0)) },
      ),
      // inclui o raciocínio do modelo: várias linhas por jogo × país
      maxOutputTokens: this.options.maxOutputTokens ?? 12_000,
      purpose: allocationPurpose(input.competition.slug, input.round, countries),
    });
    const { data, ...meta } = result;
    // como nos direitos: com grounding, só URLs da busca do provedor (nada escrito pelo modelo é buscado)
    const grounded = groundedFilter(result.groundedUrls);
    const byEvent = new Map<string, Map<string, Candidate[]>>();
    let ignored = 0;
    for (const a of data.assignments.slice(0, WTW_MAX_OPTIONS * Math.max(1, codes.length))) {
      const info = byCode.get(a.match.trim().toUpperCase());
      const country = a.country.trim().toUpperCase();
      if (!info || !holders.has(country) || !isHolder(country, a.broadcaster, a.channel)) {
        ignored++;
        continue;
      }
      const perCountry = byEvent.get(info.id) ?? new Map<string, Candidate[]>();
      const list = perCountry.get(country) ?? [];
      if (list.length >= WTW_MAX_OPTIONS) continue;
      list.push({
        broadcaster: sanitizeText(a.broadcaster, 80).trim(),
        channel: a.channel ? sanitizeText(a.channel, 80).trim() || null : null,
        region: a.region ? sanitizeText(a.region, 40).trim() || null : null,
        watchUrl: a.watch_url,
        evidence: a.evidence
          .filter((e) => grounded(e.url))
          .slice(0, WTW_MAX_EVIDENCE)
          .map(toEvidence),
      });
      perCountry.set(country, list);
      byEvent.set(info.id, perCountry);
    }
    return {
      byEvent,
      citations: result.citations,
      notes: data.notes ? sanitizeText(data.notes, 500) : null,
      result: meta,
      ignored,
    };
  }

  /** Nível 1: direitos da competição × temporada em vários países numa chamada. */
  async researchRights(input: RightsResearchInput): Promise<RightsResearchResult> {
    const countries: string[] = input.directories.map((d) => d.country);
    const result = await this.llm.generateJson<WtwRightsOutput>({
      tier: 'research',
      system: buildRightsSystemPrompt(),
      messages: [{ role: 'user', content: buildRightsUserPrompt(input) }],
      schema: WTW_RIGHTS_SCHEMA,
      schemaName: WTW_RIGHTS_SCHEMA_NAME,
      webSearch: true,
      allowedDomains: jointAllowedDomains(input.directories),
      // 8+ países com detentores e evidências, mais o raciocínio do modelo
      maxOutputTokens: this.options.maxOutputTokens ?? 16_000,
      purpose: rightsPurpose(input.competition.slug, input.season, countries),
    });
    const { data, ...meta } = result;
    const grounded = groundedFilter(result.groundedUrls);
    const wanted = new Set<string>(countries);
    const seen = new Set<string>();
    const markets: RightsCandidate[] = [];
    for (const m of data.markets) {
      const country = m.country.trim().toUpperCase();
      if (!wanted.has(country) || seen.has(country)) continue;
      seen.add(country);
      markets.push({
        country,
        distribution: m.distribution,
        notes: m.notes ? sanitizeText(m.notes, 500) : null,
        holders: m.holders.slice(0, WTW_MAX_OPTIONS).map((h) => ({
          broadcaster: sanitizeText(h.broadcaster, 80).trim(),
          channels: h.channels
            .slice(0, 10)
            .map((c) => sanitizeText(c, 80).trim())
            .filter(Boolean),
          kind: h.kind,
          allMatches: h.all_matches,
          evidence: h.evidence
            .filter((e) => e.stance !== 'denies' && grounded(e.url))
            .slice(0, WTW_MAX_EVIDENCE)
            .map(toEvidence),
        })),
      });
    }
    return {
      markets,
      notes: data.notes ? sanitizeText(data.notes, 500) : null,
      citations: result.citations,
      result: meta,
    };
  }
}

/** URL comparável (sem fragmento, barra final e caixa do host). */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim();
  }
}

/**
 * Com `groundedUrls` (Gemini em dois passos), só passam evidências cujas URLs vieram da busca do
 * provedor — nenhuma URL escrita pelo modelo chega ao validador. Sem a lista, tudo passa.
 */
export function groundedFilter(urls: readonly string[] | undefined): (url: string) => boolean {
  if (!urls) return () => true;
  const allowed = new Set(urls.map(normalizeUrl));
  return (url) => allowed.has(normalizeUrl(url));
}
