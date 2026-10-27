/**
 * Política do Conteúdo relacionado (docs/12 §2 e §5): relevância, publicação e ranking. Código, nunca LLM.
 * Imagem de jogo de qualquer canal é publicada (decisão do dono, 27/10/2026); o ranking põe oficiais e
 * detentores de direitos na frente.
 */
import type { RelatedContentType, RelatedFormat, RelatedSourceTier, RelatedStatus } from '@galaxie/db';
import type { EventCore, TeamRef } from '../context/event-core.js';
import { normalizeText } from '../guardrails/index.js';

/** Tipos com imagem de jogo (gols, melhores momentos, pênaltis, jogo completo). */
export const FOOTAGE_TYPES: ReadonlySet<RelatedContentType> = new Set([
  'highlights',
  'goal',
  'penalties',
  'full_match',
]);

export const MIN_PUBLISH_CONFIDENCE = 0.5;

const SUFFIXES = /\b(fc|sc|ec|cf|ac|cr|club|clube|futebol|football|de regatas|esporte|sport|athletic)\b/g;

/** Nomes do time para casar com títulos (normalizados, ≥ 3 caracteres). */
export function teamVariants(team: TeamRef): string[] {
  const raw = [
    team.name,
    team.shortName,
    ...team.aliases,
    ...Object.values(team.labels).filter((v): v is string => !!v),
  ].filter((v): v is string => !!v);
  const out = new Set<string>();
  for (const r of raw) {
    const n = normalizeText(r)
      .replace(/[^\p{L}\p{N} ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (n.length >= 3) out.add(n);
    const bare = n.replace(SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
    if (bare.length >= 3) out.add(bare);
  }
  return [...out];
}

/** Texto normalizado para casar nomes de time (sem acento, caixa e pontuação). */
export function matchText(raw: string): string {
  return normalizeText(raw)
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ');
}

/** O texto (já em `matchText`) cita alguma variante do nome? */
export function mentions(text: string, variants: readonly string[]): boolean {
  return variants.some((v) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(
      text,
    ),
  );
}

/**
 * O título é de outra temporada? Cita um ano ("Brasileirão 2025") e nenhum dos anos citados cobre o do jogo;
 * temporada cruzada ("2025/26", "2025-2026") cobre os dois anos. Sem ano no título, não dá para dizer.
 */
export function otherSeason(title: string, eventYear: number): boolean {
  const years = [...title.matchAll(/(?<!\d)((?:19|20)\d{2})(?:\s*[/-]\s*(\d{4}|\d{2}))?(?!\d)/g)];
  if (!years.length) return false;
  return !years.some((m) => {
    const start = Number(m[1]);
    const end = m[2]
      ? m[2].length === 2
        ? Math.floor(start / 100) * 100 + Number(m[2])
        : Number(m[2])
      : start;
    return eventYear >= start && eventYear <= end;
  });
}

export interface RelevanceInput {
  title: string;
  description: string;
  tags: readonly string[];
  publishedAt: Date;
  privacyStatus: string | null;
  embeddable: boolean;
  tier: RelatedSourceTier;
  /** Canal oficial de um dos dois clubes do jogo (`ChannelAllowlist.classify` com o escopo do jogo). */
  clubChannel?: boolean;
}

export type RelevanceVerdict = { ok: true } | { ok: false; reason: string };

/**
 * O vídeo é deste jogo? Cita os dois times (ou um só, no canal oficial de um dos clubes do jogo), público,
 * incorporável, depois do apito. Canal de liga e de emissora detentora cobre vários jogos de cada time:
 * citar um time só não basta (seria o vídeo de outro jogo dele).
 */
export function checkRelevance(
  core: Pick<EventCore, 'home' | 'away' | 'startsAt'>,
  v: RelevanceInput,
  windowDays = 7,
): RelevanceVerdict {
  if (v.privacyStatus && v.privacyStatus !== 'public') return { ok: false, reason: 'not_public' };
  if (!v.embeddable) return { ok: false, reason: 'not_embeddable' };
  const t = v.publishedAt.getTime();
  if (!Number.isFinite(t) || t < core.startsAt.getTime()) return { ok: false, reason: 'before_kickoff' };
  if (t > core.startsAt.getTime() + windowDays * 86_400_000) return { ok: false, reason: 'outside_window' };
  if (otherSeason(v.title, core.startsAt.getUTCFullYear())) return { ok: false, reason: 'other_season' };
  const text = normalizeText(`${v.title} ${v.tags.join(' ')} ${v.description.slice(0, 500)}`)
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ');
  const home = mentions(text, teamVariants(core.home));
  const away = mentions(text, teamVariants(core.away));
  if (home && away) return { ok: true };
  if ((home || away) && v.tier === 'official' && v.clubChannel) return { ok: true };
  return { ok: false, reason: home || away ? 'one_team_only' : 'teams_not_mentioned' };
}

export interface PublishDecision {
  status: RelatedStatus;
  flags: string[];
}

/** Tabela de publicação por tier do canal × tipo (docs/12 §5.6). */
export function decidePublication(input: {
  tier: RelatedSourceTier;
  type: RelatedContentType;
  confidence: number;
  format?: RelatedFormat;
  flags?: readonly string[];
}): PublishDecision {
  const flags = [...(input.flags ?? [])];
  const footage = FOOTAGE_TYPES.has(input.type);
  // decisões do dono (27/10/2026): oficial, detentor e imprensa publicam tudo; criador publica tudo menos o
  // que as regras não souberam classificar; canal desconhecido só imagem de jogo
  const trusted = input.tier === 'official' || input.tier === 'rights_holder';
  let status: RelatedStatus;
  switch (input.tier) {
    case 'official':
    case 'rights_holder':
    case 'media':
      status = 'published';
      break;
    case 'creator':
      status = input.type === 'other' ? 'pending' : 'published';
      break;
    default:
      status = footage ? 'published' : 'pending';
  }
  // tipo não reconhecido (confiança baixa): só o canal oficial ou detentor publica mesmo assim
  if (status === 'published' && !trusted && input.confidence < MIN_PUBLISH_CONFIDENCE) {
    status = 'pending';
    flags.push('low_confidence');
  }
  if (status === 'published' && flags.some((f) => f === 'offensive_title' || f === 'injection_signal'))
    status = 'pending';
  return { status, flags: [...new Set(flags)] };
}

const TIER_WEIGHT: Record<RelatedSourceTier, number> = {
  official: 3,
  rights_holder: 3,
  media: 2,
  creator: 1,
  unknown: 0,
};

const TYPE_BONUS: Record<RelatedContentType, number> = {
  highlights: 1,
  goal: 0.8,
  penalties: 0.8,
  full_match: 0.5,
  press_conference: 0.4,
  interview: 0.3,
  behind_the_scenes: 0.3,
  fan_reaction: 0.2,
  analysis: 0.2,
  other: 0,
};

/**
 * Desconto por bloqueios no player do mesmo canal e formato (ex.: live longa de canal com imagens do
 * jogo, recusada por reivindicação de direitos): um caso isolado não pesa; 2 a 4 tiram 1 ponto, 5 ou mais, 2.
 */
export function playbackBlockPenalty(blockedSameChannelFormat: number): number {
  return blockedSameChannelFormat >= 5 ? 2 : blockedSameChannelFormat >= 2 ? 1 : 0;
}

/**
 * Ranking: tier do canal + log10(visualizações)/2 + bônus do tipo − 0,5 a cada 3 dias desde o apito −
 * desconto pelos bloqueios no player do mesmo canal e formato.
 */
export function rankScore(input: {
  tier: RelatedSourceTier;
  type: RelatedContentType;
  views: number | null;
  publishedAt: Date;
  kickoff: Date;
  /** Vídeos do mesmo canal e formato que o player já recusou. */
  blockedSameChannelFormat?: number;
}): number {
  const views = Math.log10(Math.max(0, input.views ?? 0) + 1) / 2;
  const ageDays = Math.max(0, (input.publishedAt.getTime() - input.kickoff.getTime()) / 86_400_000);
  const score =
    TIER_WEIGHT[input.tier] +
    views +
    TYPE_BONUS[input.type] -
    0.5 * (ageDays / 3) -
    playbackBlockPenalty(input.blockedSameChannelFormat ?? 0);
  return Math.round(Math.max(0, score) * 1000) / 1000;
}
