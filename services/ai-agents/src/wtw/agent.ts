/**
 * Agente Onde Assistir (issue #48): LLM nível `research` com busca na web restrita à allowlist de
 * domínios do país, saída estruturada validada por JSON Schema. Só PROPÕE opções — quem decide o
 * que publicar é o validador determinístico (@galaxie/where-to-watch).
 */
import type { Candidate, CountryDirectory, RightsEntry } from '@galaxie/where-to-watch';
import { sanitizeText } from '../llm/hygiene.js';
import type { LlmCitation, LlmClient, LlmResult } from '../llm/types.js';
import type { EventInfo } from './event-info.js';
import { buildSystemPrompt, buildUserPrompt, type PreviousOption } from './prompt.js';
import {
  WTW_MAX_EVIDENCE,
  WTW_MAX_OPTIONS,
  WTW_OUTPUT_SCHEMA,
  WTW_SCHEMA_NAME,
  type WtwOutput,
} from './schema.js';

export interface ResearchInput {
  info: EventInfo;
  directory: CountryDirectory;
  rights: RightsEntry | null;
  previous: PreviousOption[];
}

export interface ResearchResult {
  candidates: Candidate[];
  citations: LlmCitation[];
  notes: string | null;
  result: Omit<LlmResult<WtwOutput>, 'data'>;
}

export interface WhereToWatchAgentOptions {
  maxOutputTokens?: number;
}

/** `purpose` segue a convenção `<agente>:...:<ISO2>` (orçamento por agente e localização da busca). */
export const wtwPurpose = (eventId: string, country: string) => `wtw:event:${eventId}:${country}`;

export class WhereToWatchAgent {
  constructor(
    private readonly llm: LlmClient,
    private readonly options: WhereToWatchAgentOptions = {},
  ) {}

  async research(input: ResearchInput): Promise<ResearchResult> {
    const country = input.directory.country;
    const result = await this.llm.generateJson<WtwOutput>({
      tier: 'research',
      system: buildSystemPrompt(country),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      schema: WTW_OUTPUT_SCHEMA,
      schemaName: WTW_SCHEMA_NAME,
      webSearch: true,
      allowedDomains: input.directory.allowedDomains(),
      maxOutputTokens: this.options.maxOutputTokens ?? 4_000,
      purpose: wtwPurpose(input.info.id, country),
    });
    const { data, ...meta } = result;
    return {
      candidates: toCandidates(data),
      citations: result.citations,
      notes: data.notes ? sanitizeText(data.notes, 500) : null,
      result: meta,
    };
  }
}

/** Saída do LLM → candidatas (limites e saneamento aplicados em código). */
export function toCandidates(output: WtwOutput): Candidate[] {
  return output.options.slice(0, WTW_MAX_OPTIONS).map((o) => ({
    broadcaster: sanitizeText(o.broadcaster, 80).trim(),
    channel: o.channel ? sanitizeText(o.channel, 80).trim() || null : null,
    medium: o.medium,
    accessModel: o.access_model,
    region: o.region ? sanitizeText(o.region, 40).trim() || null : null,
    watchUrl: o.watch_url,
    evidence: o.evidence.slice(0, WTW_MAX_EVIDENCE).map((e) => ({
      url: e.url.trim(),
      excerpt: sanitizeText(e.excerpt, 400),
      publishedAt: e.published_at && Number.isFinite(Date.parse(e.published_at)) ? e.published_at : null,
      stance: e.stance,
    })),
  }));
}
