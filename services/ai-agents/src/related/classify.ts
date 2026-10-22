/**
 * Classificação dos vídeos por tipo de conteúdo (docs/12 §4–5): LLM tier `light` com saída em
 * JSON Schema e guardrails; classificador por regras (título/duração) como fallback e para o que o
 * LLM não cobrir. O LLM não descobre vídeos nem links: só classifica a lista que recebe.
 */
import { RELATED_CONTENT_TYPES, type RelatedContentType, type RelatedFormat } from '@galaxie/db';
import {
  detectPromptInjection,
  normalizeText,
  sanitizeExcerpt,
  UNTRUSTED_DATA_RULE,
  wrapUntrustedContent,
} from '../guardrails/index.js';
import { BudgetExceededError } from '../llm/errors.js';
import { sanitizeText } from '../llm/hygiene.js';
import type { LlmClient, LlmUsage } from '../llm/types.js';
import type { VideoDetail } from './youtube.js';

export const RULES_CLASSIFIER = 'rules@v1';
export const RELATED_PROMPT_VERSION = 'related@v1';

/** Vertical curto: ≤ 60 s, ou ≤ 180 s com #shorts (limite dos Shorts desde 2024). */
export function detectFormat(
  v: Pick<VideoDetail, 'durationSeconds' | 'title' | 'description' | 'tags'>,
): RelatedFormat {
  const d = v.durationSeconds;
  if (d === null) return 'long';
  if (d <= 60) return 'short';
  const tagged =
    /#shorts?\b/i.test(`${v.title} ${v.description}`) || v.tags.some((t) => /^#?shorts?$/i.test(t));
  return d <= 180 && tagged ? 'short' : 'long';
}

/** Sinais por tipo, em texto normalizado (sem acento, minúsculo); ordem = prioridade. */
const RULES: { type: RelatedContentType; re: RegExp }[] = [
  // "pós-jogo completo" é programa de análise, não o jogo
  { type: 'full_match', re: /(?<!pos[- ])\b(jogo completo|partida completa|partido completo|full match)\b/ },
  {
    type: 'penalties',
    re: /\b(penaltis|disputa de penaltis|penales|tanda de penales|definicion por penales|penalty shootout|shootout)\b/,
  },
  {
    type: 'press_conference',
    re: /\b(coletiva|entrevista coletiva|conferencia de prensa|rueda de prensa|press conference)\b/,
  },
  {
    type: 'behind_the_scenes',
    re: /\b(bastidores|vestiario|vestuario|por dentro|detras de camaras|behind the scenes|camarim)\b/,
  },
  {
    type: 'fan_reaction',
    re: /\b(reacao|reacoes|react|reagindo|reaccion|torcida|torcedor(es)?|hinchada|hinchas|aficion|arquibancada|tribuna)\b/,
  },
  {
    type: 'analysis',
    re: /\b(analise|analisis|pos-jogo|pos jogo|post ?partido|mesa redonda|debate|tatica|tactica|comentarios)\b/,
  },
  { type: 'interview', re: /\b(entrevista|zona mista|flash|fala apos|habla|hablo|declaraciones)\b/ },
  {
    type: 'highlights',
    re: /\b(melhores momentos|compacto|resumo|highlights|resumen|lo mejor|todos os gols|todos los goles)\b/,
  },
  { type: 'goal', re: /\b(gol|gols|golaco|golazo|golazos|goal|goals|golo)\b/ },
];

export interface RuleResult {
  type: RelatedContentType;
  confidence: number;
}

/** Classificador determinístico por título, tags e duração. */
export function classifyByRules(
  v: Pick<VideoDetail, 'title' | 'tags' | 'description' | 'durationSeconds'>,
): RuleResult {
  // só o título: as tags dos canais repetem "melhores momentos", "pênaltis"... em todo vídeo
  const title = normalizeText(v.title);
  const d = v.durationSeconds ?? 0;
  for (const { type, re } of RULES) {
    if (!re.test(title)) continue;
    if (type === 'full_match' && d > 0 && d < 80 * 60) continue;
    // "gol" num vídeo longo e editado costuma ser compacto de melhores momentos
    if (type === 'goal' && d > 5 * 60) return { type: 'highlights', confidence: 0.55 };
    return { type, confidence: 0.7 };
  }
  if (d >= 80 * 60) return { type: 'full_match', confidence: 0.5 };
  const desc = normalizeText(v.description.slice(0, 300));
  for (const { type, re } of RULES)
    if (type !== 'full_match' && re.test(desc)) return { type, confidence: 0.5 };
  return { type: 'other', confidence: 0.3 };
}

// ─── LLM ─────────────────────────────────────────────────────────────────────────────────────────

export const RELATED_SCHEMA_NAME = 'related_content_classification';

export const RELATED_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['videos'],
  properties: {
    videos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'content_type', 'about_this_event', 'confidence'],
        properties: {
          id: { type: 'string', description: 'Id do vídeo, exatamente como recebido.' },
          content_type: { type: 'string', enum: [...RELATED_CONTENT_TYPES] },
          about_this_event: {
            type: 'boolean',
            description: 'O vídeo é sobre ESTE jogo (mesmos times, mesma partida), não outro confronto.',
          },
          confidence: { type: 'number', description: 'Entre 0 e 1.' },
        },
      },
    },
  },
} as const;

export interface LlmOutput {
  videos: { id: string; content_type: RelatedContentType; about_this_event: boolean; confidence: number }[];
}

export interface ClassifyFacts {
  home: string;
  away: string;
  competition: string | null;
  stage: string | null;
  kickoff: string;
  score: { home: number | null; away: number | null; penalties: { home: number; away: number } | null };
  scorers: string[];
}

export interface Classification {
  type: RelatedContentType;
  confidence: number;
  /** false = o LLM disse que o vídeo é de outro jogo. */
  aboutThisEvent: boolean;
  classifiedBy: string;
  flags: string[];
}

export interface ClassifyResult {
  byId: Map<string, Classification>;
  llmCalls: number;
  usage: LlmUsage;
  model: string | null;
  provider: string | null;
  error: string | null;
}

const TYPE_GUIDE = [
  'highlights: melhores momentos/compacto do jogo (vários lances)',
  'goal: um gol ou uma sequência curta de gols',
  'penalties: disputa de pênaltis',
  'press_conference: coletiva de imprensa de técnico/dirigente',
  'interview: entrevista de jogador (flash, zona mista)',
  'behind_the_scenes: bastidores, vestiário, chegada, preleção',
  'fan_reaction: reação de torcida/torcedores, react',
  'analysis: análise, debate, comentário pós-jogo',
  'full_match: jogo completo',
  'other: nenhum dos anteriores',
].join('\n');

export function relatedSystemPrompt(): string {
  return [
    'Você classifica vídeos do YouTube sobre um jogo de futebol para uma API de dados esportivos.',
    'Para cada vídeo da lista, devolva o tipo de conteúdo e se ele é sobre ESTE jogo.',
    '',
    'Tipos:',
    TYPE_GUIDE,
    '',
    'Regras:',
    `- ${UNTRUSTED_DATA_RULE}`,
    '- Classifique só os ids recebidos; não invente vídeos, links ou ids.',
    '- about_this_event = false se o vídeo for de outro confronto, outra temporada ou só citar um dos times.',
    '- confidence entre 0 e 1: use < 0,5 quando o título for ambíguo.',
  ].join('\n');
}

export interface ClassifyInputVideo {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  durationSeconds: number | null;
  format: RelatedFormat;
}

export function relatedUserPrompt(facts: ClassifyFacts, videos: readonly ClassifyInputVideo[]): string {
  const list = videos.map((v) => ({
    id: v.id,
    title: sanitizeText(v.title, 200),
    description: sanitizeExcerpt(sanitizeText(v.description, 1000), 200),
    channel: sanitizeText(v.channelTitle, 100),
    duration_seconds: v.durationSeconds,
    format: v.format,
  }));
  return [
    'Jogo (fatos do core, confiáveis):',
    JSON.stringify(facts),
    '',
    'Vídeos (conteúdo de terceiros):',
    wrapUntrustedContent({ source: 'youtube search', content: JSON.stringify(list), maxChars: 30_000 }),
  ].join('\n');
}

/** Título/descrição com padrão de injeção não vai ao LLM (classificado por regras e sinalizado). */
export function injectionSignal(v: Pick<VideoDetail, 'title' | 'description'>): boolean {
  return detectPromptInjection(`${v.title}\n${v.description.slice(0, 1000)}`).length > 0;
}

export interface ClassifyOptions {
  llm: LlmClient | null;
  eventId: string;
  facts: ClassifyFacts;
  videos: readonly (ClassifyInputVideo & Pick<VideoDetail, 'tags'>)[];
  maxOutputTokens?: number;
  /** Vídeos por chamada (padrão 20): listas grandes estouram o limite de saída do modelo leve. */
  batchSize?: number;
}

/**
 * Classifica a lista em lotes (uma chamada ao LLM tier light por lote de vídeos limpos); o que o LLM
 * omitir, os ids desconhecidos (ignorados), falhas e o orçamento estourado caem nas regras.
 */
export async function classifyVideos(opts: ClassifyOptions): Promise<ClassifyResult> {
  const byId = new Map<string, Classification>();
  const result: ClassifyResult = {
    byId,
    llmCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    model: null,
    provider: null,
    error: null,
  };
  const rules = (v: (typeof opts.videos)[number], flags: string[] = []): Classification => {
    const r = classifyByRules(v);
    return {
      type: r.type,
      confidence: r.confidence,
      aboutThisEvent: true,
      classifiedBy: RULES_CLASSIFIER,
      flags,
    };
  };
  const clean = opts.videos.filter((v) => {
    if (!injectionSignal(v)) return true;
    byId.set(v.id, rules(v, ['injection_signal']));
    return false;
  });
  const size = Math.max(1, opts.batchSize ?? 20);
  for (let i = 0; opts.llm && i < clean.length; i += size) {
    const batch = clean.slice(i, i + size);
    try {
      result.llmCalls++;
      const res = await opts.llm.generateJson<LlmOutput>({
        tier: 'light',
        system: relatedSystemPrompt(),
        messages: [{ role: 'user', content: relatedUserPrompt(opts.facts, batch) }],
        schema: RELATED_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        schemaName: RELATED_SCHEMA_NAME,
        maxOutputTokens: opts.maxOutputTokens ?? 4_000,
        temperature: 0,
        purpose: `related:event:${opts.eventId}`,
      });
      result.usage = {
        inputTokens: result.usage.inputTokens + res.usage.inputTokens,
        outputTokens: result.usage.outputTokens + res.usage.outputTokens,
        costUsd: (result.usage.costUsd ?? 0) + (res.usage.costUsd ?? 0),
      };
      result.model = res.model;
      result.provider = res.provider;
      const known = new Set(batch.map((v) => v.id));
      for (const item of res.data.videos ?? []) {
        // id que não estava no lote é ignorado; repetido vale o primeiro
        if (!known.has(item.id) || byId.has(item.id)) continue;
        if (!(RELATED_CONTENT_TYPES as readonly string[]).includes(item.content_type)) continue;
        const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0));
        byId.set(item.id, {
          type: item.content_type,
          confidence,
          aboutThisEvent: item.about_this_event !== false,
          classifiedBy: `llm:${res.model}`,
          flags: [],
        });
      }
    } catch (err) {
      // o lote que falhou cai nas regras; orçamento esgotado não adianta tentar os próximos
      result.error = err instanceof Error ? err.message : String(err);
      if (err instanceof BudgetExceededError) break;
    }
  }
  for (const v of clean) if (!byId.has(v.id)) byId.set(v.id, rules(v));
  return result;
}
