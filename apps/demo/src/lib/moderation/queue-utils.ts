/**
 * Regras puras da fila de revisão (#999) para a tela e as ações: a sugestão da Cosmos (ou do filtro) guardada no
 * caso, o que cada decisão da equipe exige no cargo (#1019) e o estado do prazo. Sem banco.
 */
import { sanctionAction, type TenantAction } from '@galaxie/engage';

/** O que a equipe decide num item da fila. */
export const QUEUE_DECISIONS = ['approve', 'remove', 'undo', 'mute', 'suspend', 'ban'] as const;
export type QueueDecision = (typeof QUEUE_DECISIONS)[number];

export const isQueueDecision = (v: unknown): v is QueueDecision =>
  typeof v === 'string' && (QUEUE_DECISIONS as readonly string[]).includes(v);

/** Durações oferecidas na tela (o servidor confere o teto do cargo). */
export const MUTE_HOURS = [1, 6, 24, 72] as const;
export const SUSPEND_DAYS = [1, 3, 7, 30] as const;

/** Ação da matriz de cargos que cada decisão exige. */
export function decisionAction(decision: QueueDecision): TenantAction {
  switch (decision) {
    case 'mute':
      return sanctionAction('mute', false);
    case 'suspend':
      return sanctionAction('suspension', false);
    case 'ban':
      return sanctionAction('ban', false);
    default:
      // publicar, remover e desfazer mexem só no conteúdo
      return 'moderation.hide';
  }
}

export interface Suggestion {
  /** Quem sugeriu: a Cosmos (modelo ou classificador) ou o filtro (regras fixas). */
  by: 'cosmos' | 'classifier' | 'filter';
  category: string | null;
  severity: number | null;
  /** Ações sugeridas, ou `allow` (a Cosmos acha que pode publicar). */
  actions: string[] | 'allow';
  /** Degrau de cada ação (só sinaliza, age e avisa, age sozinha). */
  steps: Record<string, string>;
  reason: string | null;
  level: number | null;
  credits: number | null;
  /** O lote caiu (sem saldo, prazo...) e o caso veio pelas regras. */
  fallback: string | null;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A sugestão guardada em `detail` (a da Cosmos vale por cima da do filtro). */
export function suggestionOf(detail: Record<string, unknown> | null): Suggestion | null {
  const cosmos = detail?.cosmos as Record<string, unknown> | undefined;
  const filter = detail?.filter as Record<string, unknown> | undefined;
  if (cosmos && typeof cosmos === 'object') {
    const s = cosmos.suggestion;
    return {
      by: cosmos.by === 'classifier' ? 'classifier' : 'cosmos',
      category: str(cosmos.category),
      severity: num(cosmos.severity),
      actions:
        s === 'allow' ? 'allow' : Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : [],
      steps:
        cosmos.steps && typeof cosmos.steps === 'object'
          ? Object.fromEntries(
              Object.entries(cosmos.steps as Record<string, unknown>).filter(
                (e): e is [string, string] => typeof e[1] === 'string',
              ),
            )
          : {},
      reason: str(cosmos.reason),
      level: num(cosmos.level),
      credits: num(cosmos.credits),
      fallback: null,
    };
  }
  if (filter && typeof filter === 'object')
    return {
      by: 'filter',
      category: null,
      severity: null,
      actions: [],
      steps: {},
      reason: null,
      level: null,
      credits: null,
      fallback: str(filter.fallback),
    };
  return null;
}

/** Decisão automática (filtro ou Cosmos) que a equipe pode desfazer. */
export const isAutomatic = (detail: Record<string, unknown> | null) =>
  Boolean(detail && ('cosmos' in detail || 'filter' in detail));

/** Prazo do item: vencido, vence em até 12 h, ou no prazo; null quando o item não tem prazo. */
export function dueState(dueAt: string | null, now: number): 'overdue' | 'soon' | 'ok' | null {
  if (!dueAt) return null;
  const left = new Date(dueAt).getTime() - now;
  if (left <= 0) return 'overdue';
  return left <= 12 * 3600_000 ? 'soon' : 'ok';
}

/** Quem decidiu, pela linha da auditoria: `user:<id>` vira o id da pessoa. */
export const personId = (actor: string) => (actor.startsWith('user:') ? actor.slice(5) : null);

/** Decisões que fazem sentido para o item (antes do cargo): apelação não se decide aqui; punir pede autor. */
export function applicableDecisions(item: {
  source: string;
  automatic: boolean;
  hasAuthor: boolean;
  room: string | null;
  community: string | null;
}): QueueDecision[] {
  if (item.source === 'appeal') return [];
  const out: QueueDecision[] = ['approve', 'remove'];
  if (item.automatic) out.push('undo');
  if (item.hasAuthor) {
    if (item.room ?? item.community) out.push('mute');
    out.push('suspend', 'ban');
  }
  return out;
}

/** Abas da tela de moderação do cliente. */
export const MODERATION_TABS = ['queue', 'history'] as const;
export type ModerationTab = (typeof MODERATION_TABS)[number];

export const QUEUE_MODULES = ['chat', 'communities', 'gamification', 'shopping', 'profile'] as const;

/** Filtros do histórico, com os valores aceitos (o que vier fora disso na URL é ignorado). */
export const HISTORY_FILTERS = {
  module: QUEUE_MODULES,
  category: [
    'offense',
    'hate',
    'harassment',
    'threat',
    'sexual',
    'spam',
    'personal_data',
    'betting',
    'minors',
  ],
  action: [
    'cosmos.allow',
    'cosmos.flag',
    'cosmos.skip',
    'filter.hold',
    'hide',
    'sanction',
    'revoke',
    'undo',
    'report',
    'appeal.decide',
    'case.resolve',
    'case.dismiss',
  ],
  actorKind: ['person', 'cosmos', 'system', 'galaxie'],
} as const;
export type HistoryFilterKey = keyof typeof HISTORY_FILTERS;
export type HistoryFilters = Partial<Record<HistoryFilterKey, string>>;

/** Só os filtros com valor aceito. */
export function pickHistoryFilters(raw: Partial<Record<string, string | undefined>>): HistoryFilters {
  const out: HistoryFilters = {};
  for (const key of Object.keys(HISTORY_FILTERS) as HistoryFilterKey[]) {
    const v = raw[key];
    if (v && (HISTORY_FILTERS[key] as readonly string[]).includes(v)) out[key] = v;
  }
  return out;
}
