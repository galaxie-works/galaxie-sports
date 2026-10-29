/**
 * Agente do canal do jogo (docs/07 §2.2.4): uma chamada `research` (Gemini com grounding) por rodada ×
 * momento, para todos os jogos e mercados do grupo. Só PROPÕE ids e fontes — quem decide é o validador
 * determinístico (`validateMatchChannels`, @galaxie/where-to-watch).
 */
import type { ChannelProposal } from '@galaxie/where-to-watch';
import { sanitizeText } from '../../llm/hygiene.js';
import type { LlmCitation, LlmClient } from '../../llm/types.js';
import type { LlmMeta } from '../agent.js';
import { jointAllowedDomains } from '../groups.js';
import type { EventInfo } from '../event-info.js';
import {
  buildChannelSystemPrompt,
  buildChannelUserPrompt,
  type ChannelMarket,
  type ChannelPhase,
} from './prompt.js';
import {
  buildChannelSchema,
  CHANNEL_MAX_EVIDENCE,
  CHANNEL_MAX_PER_MATCH,
  WTW_CHANNEL_SCHEMA_NAME,
  type ChannelOutput,
} from './schema.js';

export interface ChannelResearchInput {
  competition: { slug: string; name: string };
  season: number | null;
  round: string;
  phase: ChannelPhase;
  /** Momento (weekly, retry-3d, retry-1d, post) — entra no `purpose`. */
  window: string;
  events: EventInfo[];
  markets: ChannelMarket[];
}

export interface ChannelResearchResult {
  /** evento → país → propostas (só ids e fontes). */
  byEvent: Map<string, Map<string, ChannelProposal[]>>;
  /** URLs da busca do provedor (Gemini); null = provedor sem a garantia. */
  groundedUrls: string[] | null;
  citations: LlmCitation[];
  notes: string | null;
  result: LlmMeta;
  /** Linhas descartadas já aqui (jogo/país/emissora fora da lista do país). */
  ignored: number;
}

export const channelPurpose = (competition: string, round: string, window: string, countries: string[]) =>
  `wtw:channel:${competition}:${round.replace(/\s+/g, '_')}:${window}${countries.length === 1 ? `:${countries[0]}` : ''}`;

export class MatchChannelAgent {
  constructor(
    private readonly llm: LlmClient,
    private readonly options: { maxOutputTokens?: number } = {},
  ) {}

  async research(input: ChannelResearchInput): Promise<ChannelResearchResult> {
    const codes = input.events.map((info, i) => ({ code: `J${i + 1}`, info }));
    const byCode = new Map(codes.map((c) => [c.code, c.info]));
    const holders = new Map<string, Set<string>>(
      input.markets.map((m) => [m.directory.country, new Set(m.holders)]),
    );
    const wanted = new Map<string, Set<string>>(
      input.markets.map((m) => [m.directory.country, new Set(m.matches)]),
    );
    const countries = input.markets.map((m) => m.directory.country as string);
    const broadcasters = [...new Set(input.markets.flatMap((m) => m.holders))].sort();
    const channels = [
      ...new Set(
        input.markets.flatMap((m) => m.holders.flatMap((id) => m.directory.byIdOrNull(id)?.channels ?? [])),
      ),
    ].sort();
    const schema = buildChannelSchema({
      matches: codes.map((c) => c.code),
      countries,
      broadcasters,
      channels,
    });
    const result = await this.llm.generateJson<ChannelOutput>({
      tier: 'research',
      system: buildChannelSystemPrompt(input.phase),
      messages: [
        {
          role: 'user',
          content: buildChannelUserPrompt({
            competition: input.competition,
            season: input.season,
            round: input.round,
            phase: input.phase,
            matches: codes,
            markets: input.markets,
          }),
        },
      ],
      schema,
      schemaName: WTW_CHANNEL_SCHEMA_NAME,
      webSearch: true,
      allowedDomains: jointAllowedDomains(
        input.markets.map((m) => m.directory),
        { broadcasterIds: new Map(input.markets.map((m) => [m.directory.country, m.holders])) },
      ),
      maxOutputTokens: this.options.maxOutputTokens ?? 10_000,
      purpose: channelPurpose(input.competition.slug, input.round, input.window, countries),
      // faixa de orçamento pela prioridade da competição (#357)
      competition: { slug: input.competition.slug },
    });
    const { data, ...meta } = result;
    const byEvent = new Map<string, Map<string, ChannelProposal[]>>();
    let ignored = 0;
    for (const a of data.assignments) {
      const info = byCode.get(a.match);
      const country = a.country;
      if (!info || !holders.get(country)?.has(a.broadcaster) || !wanted.get(country)?.has(a.match)) {
        ignored++;
        continue;
      }
      const perCountry = byEvent.get(info.id) ?? new Map<string, ChannelProposal[]>();
      const list = perCountry.get(country) ?? [];
      if (list.length >= CHANNEL_MAX_PER_MATCH) continue;
      list.push({
        broadcasterId: a.broadcaster,
        channel: a.channel,
        evidence: a.evidence.slice(0, CHANNEL_MAX_EVIDENCE).map((e) => ({
          url: e.url.trim(),
          excerpt: sanitizeText(e.excerpt, 300),
          publishedAt: e.published_at && Number.isFinite(Date.parse(e.published_at)) ? e.published_at : null,
        })),
      });
      perCountry.set(country, list);
      byEvent.set(info.id, perCountry);
    }
    return {
      byEvent,
      groundedUrls: result.groundedUrls ?? null,
      citations: result.citations,
      notes: data.notes ? sanitizeText(data.notes, 500) : null,
      result: meta,
      ignored,
    };
  }
}
