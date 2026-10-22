/**
 * Política do Conteúdo relacionado (docs/12 §2 e §5): relevância, direitos e ranking. Código, nunca
 * LLM — o modelo só classifica; quem decide o que aparece é esta tabela.
 */
import type { RelatedContentType, RelatedSourceTier, RelatedStatus } from '@galaxie/db';
import type { EventCore, TeamRef } from '../context/event-core.js';
import { normalizeText } from '../guardrails/index.js';

/** Tipos com imagem de jogo: só de canal oficial ou detentor de direitos (risco de reupload). */
export const FOOTAGE_TYPES: ReadonlySet<RelatedContentType> = new Set([
  'highlights',
  'goal',
  'penalties',
  'full_match',
]);

/** Tipos de conteúdo próprio que um criador fora da allowlist pode publicar. */
export const CREATOR_TYPES: ReadonlySet<RelatedContentType> = new Set(['fan_reaction', 'analysis']);

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

function mentions(text: string, variants: readonly string[]): boolean {
  return variants.some((v) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(
      text,
    ),
  );
}

export interface RelevanceInput {
  title: string;
  description: string;
  tags: readonly string[];
  publishedAt: Date;
  privacyStatus: string | null;
  embeddable: boolean;
  tier: RelatedSourceTier;
}

export type RelevanceVerdict = { ok: true } | { ok: false; reason: string };

/** O vídeo é deste jogo? Cita os dois times (ou um, em canal oficial), público, incorporável, depois do apito. */
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
  const text = normalizeText(`${v.title} ${v.tags.join(' ')} ${v.description.slice(0, 500)}`)
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ');
  const home = mentions(text, teamVariants(core.home));
  const away = mentions(text, teamVariants(core.away));
  if (home && away) return { ok: true };
  if ((home || away) && (v.tier === 'official' || v.tier === 'rights_holder')) return { ok: true };
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
  flags?: readonly string[];
}): PublishDecision {
  const flags = [...(input.flags ?? [])];
  const footage = FOOTAGE_TYPES.has(input.type);
  let status: RelatedStatus;
  switch (input.tier) {
    case 'official':
    case 'rights_holder':
      status = 'published';
      break;
    case 'media':
      status = footage ? 'pending' : 'published';
      break;
    case 'creator':
      status = footage ? 'rejected' : CREATOR_TYPES.has(input.type) ? 'published' : 'pending';
      break;
    default:
      status = footage ? 'rejected' : 'pending';
  }
  if (footage && (input.tier === 'creator' || input.tier === 'unknown')) flags.push('rights_risk');
  if (status === 'published' && input.confidence < MIN_PUBLISH_CONFIDENCE) {
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

/** Ranking: tier do canal + log10(visualizações)/2 + bônus do tipo − 0,5 a cada 3 dias desde o apito. */
export function rankScore(input: {
  tier: RelatedSourceTier;
  type: RelatedContentType;
  views: number | null;
  publishedAt: Date;
  kickoff: Date;
}): number {
  const views = Math.log10(Math.max(0, input.views ?? 0) + 1) / 2;
  const ageDays = Math.max(0, (input.publishedAt.getTime() - input.kickoff.getTime()) / 86_400_000);
  const score = TIER_WEIGHT[input.tier] + views + TYPE_BONUS[input.type] - 0.5 * (ageDays / 3);
  return Math.round(Math.max(0, score) * 1000) / 1000;
}
