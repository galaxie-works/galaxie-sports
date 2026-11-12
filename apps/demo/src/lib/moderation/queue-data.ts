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
}

export interface DecisionItem {
  id: string;
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
  const [who, nick] = await Promise.all([
    people(rows.map((r) => personId(r.actor))),
    nicknames(
      tenantId,
      rows.map((r) => r.subjectProfileId),
    ),
  ]);
  const items = rows.map((r) => {
    const pid = personId(r.actor);
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      action: r.action,
      actorKind: r.actorKind,
      // só o nome: o e-mail de quem decidiu não aparece
      who: pid ? who.get(pid)?.name?.trim() || null : null,
      subject: r.subjectProfileId ? (nick.get(r.subjectProfileId) ?? null) : null,
      reason: r.reason,
      category: rulesStr(r.rules, 'category'),
      level: rulesNum(r.rules, 'level'),
      credits: rulesNum(r.rules, 'credits'),
      step: rulesStr(r.rules, 'step'),
      module: r.module,
      room: r.room,
      community: r.community,
    };
  });
  return { items, next: rows.length === limit ? rows[rows.length - 1]!.id : null };
}
