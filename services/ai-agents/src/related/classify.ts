/**
 * Classificação dos vídeos por tipo de conteúdo (docs/12 §4–5), só por regras de título, tags e duração.
 * Não há LLM neste fluxo: a busca é a da YouTube Data API e a classificação é código.
 */
import { type RelatedAspectRatio, type RelatedContentType, type RelatedFormat } from '@galaxie/db';
import { detectPromptInjection, normalizeText } from '../guardrails/index.js';
import type { VideoDetail } from './youtube.js';

export const RULES_CLASSIFIER = 'rules@v1';

const ASPECTS: { ratio: RelatedAspectRatio; value: number }[] = [
  { ratio: '16:9', value: 16 / 9 },
  { ratio: '9:16', value: 9 / 16 },
  { ratio: '4:3', value: 4 / 3 },
  { ratio: '1:1', value: 1 },
];

/** Proporção mais próxima das dimensões do player (comparação em log, simétrica); null sem dimensões. */
export function aspectFromFrame(width: number | null, height: number | null): RelatedAspectRatio | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const r = Math.log(width / height);
  return ASPECTS.reduce((best, a) =>
    Math.abs(Math.log(a.value) - r) < Math.abs(Math.log(best.value) - r) ? a : best,
  ).ratio;
}

type FormatInput = Pick<VideoDetail, 'durationSeconds' | 'title' | 'description' | 'tags'> &
  Partial<Pick<VideoDetail, 'frameWidth' | 'frameHeight'>>;

/**
 * Short = vertical e curto (limite dos Shorts: 3 min desde 2024). Com as dimensões do player, vale a
 * proporção real; sem elas, ≤ 60 s ou ≤ 180 s com #shorts.
 */
export function detectFormat(v: FormatInput): RelatedFormat {
  const d = v.durationSeconds;
  if (d === null) return 'long';
  const aspect = aspectFromFrame(v.frameWidth ?? null, v.frameHeight ?? null);
  if (aspect) return aspect === '9:16' && d <= 180 ? 'short' : 'long';
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

export interface Classification {
  type: RelatedContentType;
  confidence: number;
  classifiedBy: string;
  flags: string[];
}

export interface ClassifyResult {
  byId: Map<string, Classification>;
}

/** Título/descrição com padrão de injeção: sinalizado (o vídeo fica pendente, não é publicado). */
export function injectionSignal(v: Pick<VideoDetail, 'title' | 'description'>): boolean {
  return detectPromptInjection(`${v.title}\n${v.description.slice(0, 1000)}`).length > 0;
}

export interface ClassifyOptions {
  videos: readonly Pick<VideoDetail, 'id' | 'title' | 'description' | 'tags' | 'durationSeconds'>[];
}

/** Classifica a lista pelas regras de título, tags e duração (sem LLM: decisão do dono, 27/10/2026). */
export function classifyVideos(opts: ClassifyOptions): ClassifyResult {
  const byId = new Map<string, Classification>();
  for (const v of opts.videos) {
    const r = classifyByRules(v);
    byId.set(v.id, {
      type: r.type,
      confidence: r.confidence,
      classifiedBy: RULES_CLASSIFIER,
      flags: injectionSignal(v) ? ['injection_signal'] : [],
    });
  }
  return { byId };
}

/** Proporção do vídeo: das dimensões reais do player; sem elas, pelo formato (short → 9:16). */
export function aspectRatioOf(v: FormatInput): RelatedAspectRatio {
  return (
    aspectFromFrame(v.frameWidth ?? null, v.frameHeight ?? null) ??
    (detectFormat(v) === 'short' ? '9:16' : '16:9')
  );
}
