/**
 * Fila única da moderação (#953, B8): denúncia, bloqueio, punição (a Escada), apelação e o registro de auditoria.
 * Aqui só as regras, sem banco nem HTTP; o banco fica em `@galaxie/db` (`moderation-queue.ts`) e as rotas na API.
 *
 * - **Denúncia** de mensagem, comentário, post, Perfil, nome de Comunidade ou Liga e comportamento, com motivo. Um
 *   torcedor não denuncia o mesmo conteúdo duas vezes; com N denúncias de torcedores diferentes o conteúdo fica
 *   oculto até a revisão (o cliente escolhe N, com teto da Galaxie).
 * - **Fila única:** denúncia, conteúdo segurado pelo filtro (B7), sugestão da Cosmos (#998, #999) e apelação, em
 *   ordem de gravidade. Nenhum módulo cria outra.
 * - **Escada:** Advertência e Silenciar valem onde aconteceu; Expulsão, na Comunidade; Suspensão e Banimento, em
 *   todas as Comunidades e Salas do Jogo do cliente. Age só no que a Galaxie hospeda.
 * - **Silêncio oculto:** opção do cliente, só por pessoa (nunca pela Cosmos), com prazo; indisponível onde a ficha
 *   do país exige aviso de punição (`punishmentNoticeRequired`).
 * - **Apelação:** uma por punição; julga quem não aplicou. Se a primeira resposta veio da Cosmos, a segunda vai para
 *   uma pessoa; sem equipe do cliente, para a fila de segunda apelação da Galaxie.
 */
import type { CountryPolicy } from './country-policy.js';
import type { TenantAction } from './roles.js';

/** O que se denuncia. */
export const REPORT_TARGETS = [
  'message',
  'comment',
  'post',
  'profile',
  'community_name',
  'league_name',
  'behavior',
] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

/** Motivo da denúncia. */
export const REPORT_REASONS = [
  'hate',
  'harassment',
  'threat',
  'sexual',
  'spam',
  'betting',
  'personal_data',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** De onde veio o caso da fila. */
export const CASE_SOURCES = ['report', 'filter', 'cosmos', 'appeal'] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

export const CASE_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Módulos que mandam casos para a fila. */
export const CASE_MODULES = ['chat', 'communities', 'gamification', 'shopping', 'profile'] as const;
export type CaseModule = (typeof CASE_MODULES)[number];

/** Gravidade (maior = mais grave), para ordenar a fila. Ameaça e ódio no topo. */
export const REASON_SEVERITY: Record<ReportReason, number> = {
  threat: 100,
  hate: 90,
  sexual: 80,
  harassment: 70,
  personal_data: 60,
  betting: 50,
  spam: 30,
  other: 20,
};

/** Gravidade do caso: a do motivo mais grave, com um pouco a mais por denúncia (até +9). */
export function caseSeverity(reasons: readonly ReportReason[], reports = reasons.length): number {
  const base = Math.max(0, ...reasons.map((r) => REASON_SEVERITY[r] ?? 0));
  return base + Math.min(9, Math.max(0, reports - 1));
}

/** Denúncias de torcedores diferentes que ocultam o conteúdo até a revisão: padrão e teto da Galaxie. */
export const HIDE_THRESHOLD_DEFAULT = 3;
export const HIDE_THRESHOLD_MAX = 10;
/** Limite de denúncias por torcedor por hora (denúncia em massa). */
export const REPORTS_PER_HOUR = 20;

/** O número que vale para o cliente: dentro de 1 a `HIDE_THRESHOLD_MAX`; fora disso, o padrão. */
export function hideThreshold(configured: number | null | undefined): number {
  if (configured === null || configured === undefined || !Number.isInteger(configured))
    return HIDE_THRESHOLD_DEFAULT;
  return Math.min(HIDE_THRESHOLD_MAX, Math.max(1, configured));
}

/** O conteúdo deve ficar oculto até a revisão? Perfil e comportamento não se ocultam (a equipe decide). */
export const shouldHide = (target: ReportTarget, distinctReporters: number, threshold: number) =>
  target !== 'profile' && target !== 'behavior' && distinctReporters >= threshold;

// ---------------------------------------------------------------------------------------------------------------
// Escada

export const SANCTION_LEVELS = ['warning', 'mute', 'suspension', 'expulsion', 'ban'] as const;
export type SanctionLevel = (typeof SANCTION_LEVELS)[number];

/** Alcance: onde aconteceu (sala ou Comunidade), a Comunidade ou o cliente inteiro. */
export type SanctionScope = 'place' | 'community' | 'tenant';

export const SANCTION_SCOPE: Record<SanctionLevel, SanctionScope> = {
  warning: 'place',
  mute: 'place',
  suspension: 'tenant',
  expulsion: 'community',
  ban: 'tenant',
};

/** Ação da matriz de cargos (#1019) que cada degrau exige. */
export function sanctionAction(level: SanctionLevel, hidden: boolean): TenantAction {
  if (hidden) return 'moderation.shadow_mute';
  switch (level) {
    case 'warning':
      return 'moderation.hide';
    case 'mute':
      return 'moderation.mute';
    case 'suspension':
      return 'moderation.suspend';
    case 'expulsion':
      return 'moderation.expel';
    case 'ban':
      return 'moderation.ban';
  }
}

/** Quem decide: uma pessoa da equipe do cliente, a Cosmos ou a equipe da Galaxie. */
export type DeciderKind = 'person' | 'cosmos' | 'galaxie';

export interface SanctionRequest {
  level: SanctionLevel;
  /** Silêncio oculto: o punido não é avisado. Só `mute`. */
  hidden: boolean;
  /** Fim, em ms desde a época; `null` = sem prazo (Advertência, Expulsão e Banimento). */
  endsAt: number | null;
  /** Comunidade (Expulsão) ou lugar (Advertência e Silenciar). */
  scopeId: string | null;
  decidedBy: DeciderKind;
}

export type SanctionProblem =
  | 'hidden_needs_mute'
  | 'hidden_not_allowed'
  | 'hidden_by_cosmos'
  | 'hidden_needs_end'
  | 'needs_end'
  | 'end_in_past'
  | 'needs_scope'
  | 'cosmos_level';

/** Prazo máximo do Silêncio oculto (o mesmo da Suspensão por tempo). */
export const HIDDEN_MUTE_MAX_MS = 7 * 24 * 3600_000;

/**
 * Confere o pedido de punição. `hiddenEnabled`: o cliente ligou o Silêncio oculto; `policy`: a ficha do país do
 * torcedor (sem ficha, o Silêncio oculto fica desligado). A Cosmos só sugere Advertência e Silenciar.
 */
export function checkSanction(
  req: SanctionRequest,
  ctx: {
    now: number;
    hiddenEnabled: boolean;
    policy: Pick<CountryPolicy, 'punishmentNoticeRequired'> | null;
  },
): SanctionProblem[] {
  const out: SanctionProblem[] = [];
  if (req.hidden) {
    if (req.level !== 'mute') out.push('hidden_needs_mute');
    if (req.decidedBy === 'cosmos') out.push('hidden_by_cosmos');
    if (!ctx.hiddenEnabled || !ctx.policy || ctx.policy.punishmentNoticeRequired)
      out.push('hidden_not_allowed');
    if (req.endsAt === null || req.endsAt - ctx.now > HIDDEN_MUTE_MAX_MS) out.push('hidden_needs_end');
  }
  if (req.decidedBy === 'cosmos' && req.level !== 'warning' && req.level !== 'mute') out.push('cosmos_level');
  if ((req.level === 'mute' || req.level === 'suspension') && req.endsAt === null && !req.hidden)
    out.push('needs_end');
  if (req.endsAt !== null && req.endsAt <= ctx.now) out.push('end_in_past');
  if (SANCTION_SCOPE[req.level] !== 'tenant' && !req.scopeId) out.push('needs_scope');
  return out;
}

/** A punição vale agora? */
export const sanctionActive = (s: { endsAt: number | null; revokedAt: number | null }, now: number) =>
  s.revokedAt === null && (s.endsAt === null || now < s.endsAt);

// ---------------------------------------------------------------------------------------------------------------
// Apelação

/** Prazo padrão da apelação (72 h); o cliente muda entre 24 h e 14 dias. */
export const APPEAL_DUE_DEFAULT_H = 72;
export const appealDueHours = (configured: number | null | undefined) =>
  configured && Number.isInteger(configured) ? Math.min(336, Math.max(24, configured)) : APPEAL_DUE_DEFAULT_H;

export type AppealStage = 1 | 2;

/** Para onde vai a apelação: a equipe do cliente (com a ação exigida) ou a fila da Galaxie. */
export type AppealRoute = { to: 'team'; action: TenantAction; personOnly: boolean } | { to: 'galaxie' };

/**
 * Primeira apelação: equipe do cliente (moderador). Segunda: só existe quando a primeira resposta veio da Cosmos;
 * vai para pessoa com `moderation.appeal.second` e, sem ninguém com esse cargo, para a Galaxie.
 */
export function appealRoute(
  stage: AppealStage,
  ctx: { firstDecidedBy?: DeciderKind; teamCanJudge: boolean },
): AppealRoute | null {
  if (stage === 1) return { to: 'team', action: 'moderation.appeal.first', personOnly: false };
  if (ctx.firstDecidedBy !== 'cosmos') return null;
  return ctx.teamCanJudge
    ? { to: 'team', action: 'moderation.appeal.second', personOnly: true }
    : { to: 'galaxie' };
}

/**
 * Pode julgar a apelação? Quem aplicou a punição (ou julgou a etapa anterior) não julga. A segunda etapa nunca é da
 * Cosmos.
 */
export function canJudgeAppeal(input: {
  judge: { kind: DeciderKind; id: string | null };
  appliedBy: string | null;
  previousJudge: string | null;
  stage: AppealStage;
}): boolean {
  if (input.stage === 2 && input.judge.kind === 'cosmos') return false;
  if (input.judge.kind === 'cosmos') return true;
  if (!input.judge.id) return false;
  return input.judge.id !== input.appliedBy && input.judge.id !== input.previousJudge;
}

// ---------------------------------------------------------------------------------------------------------------
// Guarda legal (D5)

/** Quando o conteúdo removido e a decisão saem do banco, pelos relógios da ficha do país. */
export function retentionDeadlines(
  policy: Pick<CountryPolicy, 'retention'>,
  at: number,
): { contentPurgeAt: number; decisionPurgeAt: number } {
  const day = 24 * 3600_000;
  return {
    contentPurgeAt: at + policy.retention.removedContentDays * day,
    decisionPurgeAt: at + policy.retention.moderationDecisionsDays * day,
  };
}
