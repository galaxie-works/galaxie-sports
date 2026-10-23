/**
 * Biografia de piloto de F1 para a base semântica (perfil `draft`, revisado no painel antes de ser servido).
 *
 * O LLM (tier `research`, com busca na web) recebe os fatos da nossa base (F1DB) como âncora e devolve frases
 * curtas em pt-BR, cada uma com a URL da fonte. Regras, no código e não no prompt:
 * - frase sem fonte, ou com fonte que não veio da busca (`groundedUrls` do Gemini) ou de domínio não
 *   permitido, **não entra** — não se inventa nada;
 * - termo proibido, padrão de prompt injection ou letra de música reprovam a frase;
 * - sem nenhuma frase com fonte, não há proposta.
 */
import { checkProse } from '@galaxie/knowledge';
import {
  detectPromptInjection,
  findForbiddenTerms,
  isAllowedUrl,
  UNTRUSTED_DATA_RULE,
} from '../guardrails/index.js';
import type { LlmClient, LlmUsage } from '../llm/types.js';

export interface DriverFacts {
  f1dbId: string;
  name: string;
  /** ISO2 do país do piloto (do F1DB). */
  country: string | null;
  abbreviation: string | null;
  seasons: { first: number; last: number } | null;
  teams: string[];
  titles: number[];
  wins: number;
  races: number;
}

export interface BioSentence {
  text: string;
  source: string;
}

export interface BioProposal {
  facts: DriverFacts;
  status: 'accepted' | 'rejected';
  reasons: string[];
  officialName: string | null;
  city: string | null;
  region: string | null;
  nicknames: string[];
  identity: BioSentence[];
  /** Frases descartadas e o motivo (para o relatório). */
  dropped: { text: string; reason: string }[];
  model?: string;
  usage?: LlmUsage;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['official_name', 'city', 'region', 'nicknames', 'identity'],
  properties: {
    official_name: { type: ['string', 'null'] },
    city: { type: ['string', 'null'], description: 'Cidade natal.' },
    region: { type: ['string', 'null'], description: 'Estado ou província natal.' },
    nicknames: { type: 'array', items: { type: 'string' } },
    identity: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'source'],
        properties: {
          text: { type: 'string', description: 'Uma frase factual em português, até 220 caracteres.' },
          source: { type: 'string', description: 'URL da fonte que sustenta a frase.' },
        },
      },
    },
  },
} as const;

export function bioPrompt(f: DriverFacts): string {
  const facts = [
    `Nome: ${f.name}${f.abbreviation ? ` (${f.abbreviation})` : ''}`,
    f.country ? `País: ${f.country}` : null,
    f.seasons ? `Temporadas na F1: ${f.seasons.first}–${f.seasons.last}` : null,
    f.teams.length ? `Equipes: ${f.teams.join(', ')}` : null,
    `Corridas: ${f.races}; vitórias: ${f.wins}${f.titles.length ? `; títulos mundiais: ${f.titles.join(', ')}` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    `Escreva o perfil biográfico do piloto de Fórmula 1 abaixo para uma base de dados esportiva (TV e streaming na América Latina).`,
    `Fatos da nossa base (confiáveis; use como âncora, não precisa repetir números):\n${facts}`,
    'Pesquise na web e devolva:',
    '- official_name: nome completo de registro; city e region: cidade e estado/província natal;',
    '- nicknames: apelidos conhecidos e verificáveis (vazio se não houver);',
    '- identity: de 3 a 6 frases curtas em português do Brasil, cada uma com UM fato marcante e verificável da carreira ou da vida (origem, estreia, títulos, momentos históricos, legado), cada uma com a URL da fonte que a sustenta.',
    'Regras: só fatos com fonte; nada de opinião, adjetivo exagerado ou especulação; não copie texto literal das páginas; prefira fontes de referência (enciclopédias, imprensa esportiva, sites oficiais).',
  ].join('\n\n');
}

export async function proposeBio(llm: LlmClient, facts: DriverFacts): Promise<BioProposal> {
  const base: BioProposal = {
    facts,
    status: 'rejected',
    reasons: [],
    officialName: null,
    city: null,
    region: null,
    nicknames: [],
    identity: [],
    dropped: [],
  };
  const result = await llm.generateJson<{
    official_name: string | null;
    city: string | null;
    region: string | null;
    nicknames: string[];
    identity: BioSentence[];
  }>({
    tier: 'research',
    webSearch: true,
    system: `Você é pesquisador de uma base de dados esportiva. ${UNTRUSTED_DATA_RULE}`,
    messages: [{ role: 'user', content: bioPrompt(facts) }],
    schema: SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'f1_driver_bio',
    purpose: `f1bio:${facts.f1dbId}`,
  });
  const grounded = result.groundedUrls ? new Set(result.groundedUrls) : null;
  const cited = new Set(result.citations.map((c) => c.url));
  const out: BioProposal = { ...base, model: result.model, usage: result.usage };
  for (const s of result.data.identity) {
    const text = s.text.replace(/\s+/g, ' ').trim();
    const reject = (reason: string) => out.dropped.push({ text, reason });
    if (!text) continue;
    if (text.length > 260) reject('frase longa demais');
    else if (!s.source || !/^https?:\/\//.test(s.source)) reject('sem fonte');
    else if (grounded ? !grounded.has(s.source) : !cited.has(s.source)) reject('fonte não veio da busca');
    else if (!isAllowedUrl(s.source)) reject('domínio da fonte não permitido');
    else if (detectPromptInjection(text).length) reject('padrão de prompt injection');
    else if (findForbiddenTerms(text, 'pt-BR').length) reject('termo proibido');
    else if (checkProse(text)?.level === 'error') reject('texto reprovado pelo validador da base');
    else out.identity.push({ text, source: s.source });
  }
  if (!out.identity.length) {
    out.reasons.push('nenhuma frase com fonte verificável');
    return out;
  }
  // nome, cidade e apelidos só entram junto de frases com fonte (vêm da mesma pesquisa)
  out.status = 'accepted';
  out.officialName = result.data.official_name?.trim() || null;
  out.city = result.data.city?.trim() || null;
  out.region = result.data.region?.trim() || null;
  out.nicknames = [...new Set(result.data.nicknames.map((n) => n.trim()).filter(Boolean))].slice(0, 5);
  return out;
}

/** Junta as propostas novas às de uma execução anterior: a nova substitui a do mesmo piloto. */
export function mergeProposals(previous: BioProposal[], fresh: BioProposal[]): BioProposal[] {
  const byId = new Map(previous.map((p) => [p.facts.f1dbId, p]));
  for (const p of fresh) byId.set(p.facts.f1dbId, p);
  return [...byId.values()];
}
