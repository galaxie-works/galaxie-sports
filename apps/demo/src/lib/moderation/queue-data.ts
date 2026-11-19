/**
 * Dados da fila de revisão e do histórico de decisões (#999), lidos da fila única da base (#953). Só servidor. O
 * tenant vem sempre da sessão; os nomes de quem decidiu e o apelido do torcedor entram aqui, nunca o e-mail.
 */
import {
  listDecisions,
  listQueue,
  type DecisionFilter,
  type DecisionRow,
  type ModerationCaseView,
} from '@galaxie/db/moderation-queue';
import { pool } from '@/lib/auth/db';
import { builderDb } from '@/lib/builder/store';
import { people } from '@/lib/cosmos/data';

import { isAutomatic, personId, suggestionOf, type Suggestion } from './queue-utils';

export interface QueueItem {
  id: string;
  source: string;
  targetType: string;
  module: string;
  room: string | null;
  community: string | null;
  reasons: string[];
  severity: number;
  reportCount: number;
  hidden: boolean;
  content: string | null;
  author: string | null;
  hasAuthor: boolean;
  createdAt: string;
  dueAt: string | null;
  suggestion: Suggestion | null;
  automatic: boolean;
  /** Suspeita de abuso infantil (#1289): só fecha depois da denúncia às autoridades. */
  childSafety: boolean;
  /** Já denunciado às autoridades (a guarda legal conta daí). */
  authorityReported: boolean;
}

export interface DecisionItem {
  id: string;
  caseId: string | null;
  /** Fechamento automático (Cosmos ou filtro) que a equipe pode desfazer daqui (o servidor confere de novo). */
  undoable: boolean;
  at: string;
  action: string;
  actorKind: string;
  who: string | null;
  subject: string | null;
  reason: string | null;
  category: string | null;
  level: number | null;
  credits: number | null;
  step: string | null;
  module: string | null;
  room: string | null;
  community: string | null;
  /**
   * Dá para denunciar às autoridades daqui (#1296): o caso existe, não é de apelação e ainda não foi denunciado (o
   * servidor confere o cargo de novo). Só na primeira linha do caso, para o botão não se repetir.
   */
  reportable: boolean;
}

/** Casos que ainda podem ser denunciados às autoridades: existem, não são apelação e não foram denunciados. */
async function reportableCases(tenantId: string, caseIds: string[]): Promise<Set<string>> {
  if (caseIds.length === 0) return new Set();
  const { rows } = await pool.query<{ id: string }>(
    `select id::text from engage.moderation_case
      where tenant_id = $1 and id = any($2::uuid[]) and source <> 'appeal' and authority_reported_at is null`,
    [tenantId, caseIds],
  );
  return new Set(rows.map((r) => r.id));
}

export interface QueueFilters {
  module?: string;
  room?: string;
  community?: string;
}

/** Apelido do torcedor (o Perfil é do mesmo cliente: o filtro por tenant vale aqui também). */
async function nicknames(tenantId: string, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map();
  const { rows } = await pool.query<{ id: string; nickname: string | null }>(
    'select id::text, nickname from fan.profile where tenant_id = $1 and id = any($2::uuid[])',
    [tenantId, wanted],
  );
  return new Map(rows.filter((r) => r.nickname).map((r) => [r.id, r.nickname!]));
}

const toItem = (c: ModerationCaseView, nick: Map<string, string>): QueueItem => ({
  id: c.id,
  source: c.source,
  targetType: c.targetType,
  module: c.module,
  room: c.room,
  community: c.community,
  reasons: c.reasons,
  severity: c.severity,
  reportCount: c.reportCount,
  hidden: c.hiddenAt !== null,
  content: c.content,
  author: c.targetProfileId ? (nick.get(c.targetProfileId) ?? null) : null,
  hasAuthor: c.targetProfileId !== null,
  createdAt: c.createdAt.toISOString(),
  dueAt: c.dueAt?.toISOString() ?? null,
  suggestion: suggestionOf(c.detail),
  automatic: isAutomatic(c.detail),
  childSafety: c.childSafety,
  authorityReported: c.authorityReportedAt !== null,
});

export async function loadModerationQueue(
  tenantId: string,
  filters: QueueFilters = {},
): Promise<QueueItem[]> {
  const cases = await listQueue(builderDb(), tenantId, { ...filters, limit: 100 });
  const nick = await nicknames(
    tenantId,
    cases.map((c) => c.targetProfileId),
  );
  return cases.map((c) => toItem(c, nick));
}

const rulesNum = (r: Record<string, unknown> | null, k: string) =>
  typeof r?.[k] === 'number' ? (r[k] as number) : null;
const rulesStr = (r: Record<string, unknown> | null, k: string) =>
  typeof r?.[k] === 'string' ? (r[k] as string) : null;

export async function loadDecisions(
  tenantId: string,
  filter: DecisionFilter = {},
): Promise<{ items: DecisionItem[]; next: string | null }> {
  const limit = 50;
  const rows: DecisionRow[] = await listDecisions(builderDb(), tenantId, { ...filter, limit });
  const [who, nick, reportable] = await Promise.all([
    people(rows.map((r) => personId(r.actor))),
    nicknames(
      tenantId,
      rows.map((r) => r.subjectProfileId),
    ),
    reportableCases(tenantId, [...new Set(rows.flatMap((r) => (r.caseId ? [r.caseId] : [])))]),
  ]);
  const shown = new Set<string>();
  const items = rows.map((r) => {
    const pid = personId(r.actor);
    const first = !!r.caseId && !shown.has(r.caseId);
    if (r.caseId) shown.add(r.caseId);
    return {
      id: r.id,
      caseId: r.caseId,
      undoable:
        r.action === 'case.resolve' && (r.actorKind === 'cosmos' || r.actorKind === 'system') && !!r.caseId,
      at: r.createdAt.toISOString(),
      action: r.action,
      actorKind: r.actorKind,
      // só o nome: o e-mail de quem decidiu não aparece
      who: pid ? who.get(pid)?.name?.trim() || null : null,
      subject: r.subjectProfileId ? (nick.get(r.subjectProfileId) ?? null) : null,
      // de pessoa, o motivo é um código fixo (a nota livre fica com o caso); da Cosmos, a régua da hora
      reason: r.actorKind === 'cosmos' || r.actorKind === 'system' ? r.reason : null,
      category: rulesStr(r.rules, 'category'),
      level: rulesNum(r.rules, 'level'),
      credits: rulesNum(r.rules, 'credits'),
      step: rulesStr(r.rules, 'step'),
      module: r.module,
      room: r.room,
      community: r.community,
      reportable: first && reportable.has(r.caseId!),
    };
  });
  return { items, next: rows.length === limit ? rows[rows.length - 1]!.id : null };
}
