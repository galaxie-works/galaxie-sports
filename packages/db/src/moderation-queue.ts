/**
 * Fila única da moderação (#953, B8): denúncia, conteúdo segurado (filtro e Cosmos), bloqueio entre torcedores,
 * punição (a Escada), apelação, registro de auditoria e o expurgo por relógio. As regras (gravidade, limite de
 * ocultar, quem julga) vêm de `@galaxie/engage` e chegam aqui prontas, como números e funções: este pacote não
 * depende de outro `@galaxie/*`.
 *
 * Toda escrita grava a linha da auditoria na mesma transação. A auditoria só cresce (gatilho no banco); o expurgo
 * (`purgeModeration`) e a exclusão do torcedor (`eraseModerationContent`) são as únicas exceções.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  fanBlock,
  moderationAppeal,
  moderationAudit,
  moderationCase,
  moderationReport,
  moderationSanction,
} from './schema/moderation.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

export type ModerationActorKind = 'person' | 'cosmos' | 'galaxie' | 'system' | 'fan';

export interface ModerationActor {
  /** `user:<id>`, `cosmos`, `galaxie:<id>`, `fan:<perfil>` ou `system`. */
  id: string;
  kind: ModerationActorKind;
}

/** Relógios da ficha do país (D5), já resolvidos em instantes. */
export interface ModerationClocks {
  contentPurgeAt: Date;
  decisionPurgeAt: Date;
}

export interface ModerationCaseView {
  id: string;
  source: string;
  targetType: string;
  targetId: string;
  targetProfileId: string | null;
  module: string;
  room: string | null;
  community: string | null;
  reasons: string[];
  severity: number;
  reportCount: number;
  status: string;
  hiddenAt: Date | null;
  content: string | null;
  detail: Record<string, unknown> | null;
  sanctionId: string | null;
  createdAt: Date;
}

async function audit(
  tx: Executor,
  row: {
    tenantId: string;
    actor: ModerationActor;
    action: string;
    clocks: ModerationClocks;
    subjectProfileId?: string | null;
    caseId?: string | null;
    sanctionId?: string | null;
    appealId?: string | null;
    reason?: string | null;
    rules?: Record<string, unknown> | null;
    content?: string | null;
  },
): Promise<void> {
  await tx.insert(moderationAudit).values({
    tenantId: row.tenantId,
    actor: row.actor.id,
    actorKind: row.actor.kind,
    action: row.action,
    subjectProfileId: row.subjectProfileId ?? null,
    caseId: row.caseId ?? null,
    sanctionId: row.sanctionId ?? null,
    appealId: row.appealId ?? null,
    reason: row.reason ?? null,
    rules: row.rules ?? null,
    content: row.content ?? null,
    contentPurgeAt: row.content ? row.clocks.contentPurgeAt : null,
    purgeAt: row.clocks.decisionPurgeAt,
  });
}

/** `text[]` a partir de uma lista (o driver não manda array JS como parâmetro de `sql`). */
const textArray = (items: readonly string[]) =>
  sql`array[${sql.join(
    items.map((i) => sql`${i}`),
    sql`, `,
  )}]::text[]`;

const uniqueViolation = (err: unknown, constraint: string) => {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth += 1) {
    const x = e as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (x.code === '23505' && (x.constraint_name ?? x.constraint) === constraint) return true;
    e = x.cause;
  }
  return false;
};

// ---------------------------------------------------------------------------------------------------------------
// Caso e denúncia

export interface CaseTarget {
  tenantId: string;
  targetType: string;
  targetId: string;
  targetProfileId: string | null;
  module: string;
  room: string | null;
  community: string | null;
}

/** Abre o caso do conteúdo, ou devolve o caso aberto que já existe (trava a linha). */
async function openCase(
  tx: Tx,
  t: CaseTarget,
  init: {
    source: 'report' | 'filter' | 'cosmos';
    severity: number;
    content: string | null;
    clocks: ModerationClocks;
  },
): Promise<{ id: string; created: boolean }> {
  const find = () =>
    tx
      .select({ id: moderationCase.id })
      .from(moderationCase)
      .where(
        and(
          eq(moderationCase.tenantId, t.tenantId),
          eq(moderationCase.targetType, t.targetType),
          eq(moderationCase.targetId, t.targetId),
          eq(moderationCase.status, 'open'),
          sql`${moderationCase.source} <> 'appeal'`,
        ),
      )
      .for('update')
      .limit(1);
  const [found] = await find();
  if (found) return { id: found.id, created: false };
  const [row] = await tx
    .insert(moderationCase)
    .values({
      tenantId: t.tenantId,
      source: init.source,
      targetType: t.targetType,
      targetId: t.targetId,
      targetProfileId: t.targetProfileId,
      module: t.module,
      room: t.room,
      community: t.community,
      severity: init.severity,
      content: init.content,
      contentPurgeAt: init.content ? init.clocks.contentPurgeAt : null,
    })
    .onConflictDoNothing()
    .returning({ id: moderationCase.id });
  if (row) return { id: row.id, created: true };
  // outra denúncia abriu o caso ao mesmo tempo
  const [again] = await find();
  if (!again) throw new Error('caso da moderação sumiu durante a abertura');
  return { id: again.id, created: false };
}

export type FileReportResult =
  | { ok: true; caseId: string; hidden: boolean; duplicate: boolean }
  | { ok: false; reason: 'rate_limited' | 'self_report' };

/**
 * Denúncia de um torcedor. Um torcedor denuncia o mesmo conteúdo uma vez (a segunda devolve `duplicate`); mais de
 * `rules.perHour` denúncias na última hora são recusadas. Com `rules.hideAt` denunciantes diferentes o conteúdo
 * fica oculto até a revisão (`rules.hides` diz se o tipo de conteúdo se oculta).
 */
export async function fileReport(
  db: Database,
  input: CaseTarget & {
    reporterProfileId: string;
    reason: string;
    note: string | null;
    content: string | null;
    clocks: ModerationClocks;
    rules: {
      perHour: number;
      hideAt: number;
      hides: boolean;
      severity: (reasons: string[], reports: number) => number;
    };
    now?: Date;
  },
): Promise<FileReportResult> {
  if (input.targetProfileId && input.targetProfileId === input.reporterProfileId)
    return { ok: false, reason: 'self_report' };
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // denúncia em massa: trava por denunciante para a contagem valer com pedidos em paralelo
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`engage.report:${input.tenantId}:${input.reporterProfileId}`}, 0))`,
    );
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(moderationReport)
      .where(
        and(
          eq(moderationReport.tenantId, input.tenantId),
          eq(moderationReport.reporterProfileId, input.reporterProfileId),
          gte(moderationReport.createdAt, new Date(now.getTime() - 3600_000)),
        ),
      );
    if (n >= input.rules.perHour) return { ok: false, reason: 'rate_limited' } as const;

    const c = await openCase(tx, input, {
      source: 'report',
      severity: input.rules.severity([input.reason], 1),
      content: input.content,
      clocks: input.clocks,
    });
    const [report] = await tx
      .insert(moderationReport)
      .values({
        tenantId: input.tenantId,
        caseId: c.id,
        reporterProfileId: input.reporterProfileId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        note: input.note,
      })
      .onConflictDoNothing()
      .returning({ id: moderationReport.id });
    const [current] = await tx
      .select({ hiddenAt: moderationCase.hiddenAt })
      .from(moderationCase)
      .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, c.id)));
    if (!report)
      return { ok: true, caseId: c.id, hidden: current?.hiddenAt != null, duplicate: true } as const;

    const stats = await tx
      .select({
        reasons: sql<string[]>`array_agg(distinct ${moderationReport.reason})`,
        reporters: sql<number>`count(distinct ${moderationReport.reporterProfileId})::int`,
      })
      .from(moderationReport)
      .where(and(eq(moderationReport.tenantId, input.tenantId), eq(moderationReport.caseId, c.id)));
    const reasons = stats[0]?.reasons ?? [input.reason];
    const reporters = stats[0]?.reporters ?? 1;
    const hide = input.rules.hides && reporters >= input.rules.hideAt && current?.hiddenAt == null;
    await tx
      .update(moderationCase)
      .set({
        reasons: sql`(select array(select distinct unnest(${moderationCase.reasons} || ${textArray(reasons)}) order by 1))`,
        reportCount: reporters,
        severity: sql`greatest(${moderationCase.severity}, ${input.rules.severity(reasons, reporters)})`,
        ...(hide ? { hiddenAt: now } : {}),
        // conteúdo original: guarda o da primeira denúncia que trouxe
        ...(input.content
          ? {
              content: sql`coalesce(${moderationCase.content}, ${input.content})`,
              contentPurgeAt: sql`coalesce(${moderationCase.contentPurgeAt}, ${input.clocks.contentPurgeAt.toISOString()}::timestamptz)`,
            }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, c.id)));
    const actor: ModerationActor = { id: `fan:${input.reporterProfileId}`, kind: 'fan' };
    await audit(tx, {
      tenantId: input.tenantId,
      actor,
      action: 'report',
      clocks: input.clocks,
      subjectProfileId: input.targetProfileId,
      caseId: c.id,
      reason: input.reason,
    });
    if (hide)
      await audit(tx, {
        tenantId: input.tenantId,
        actor: { id: 'system', kind: 'system' },
        action: 'hide',
        clocks: input.clocks,
        subjectProfileId: input.targetProfileId,
        caseId: c.id,
        reason: 'report_threshold',
        rules: { hideAt: input.rules.hideAt, reporters },
      });
    return { ok: true, caseId: c.id, hidden: hide || current?.hiddenAt != null, duplicate: false } as const;
  });
}

/**
 * Conteúdo segurado pelo filtro (B7) ou sugerido pela Cosmos (#998, #999): entra na mesma fila, no caso aberto do
 * conteúdo se já houver. `hide` oculta até a revisão (o filtro já não publicou).
 */
export async function holdContent(
  db: Database,
  input: CaseTarget & {
    source: 'filter' | 'cosmos';
    reasons: string[];
    severity: number;
    hide: boolean;
    content: string | null;
    detail: Record<string, unknown> | null;
    clocks: ModerationClocks;
    now?: Date;
  },
): Promise<{ caseId: string }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const c = await openCase(tx, input, {
      source: input.source,
      severity: input.severity,
      content: input.content,
      clocks: input.clocks,
    });
    await tx
      .update(moderationCase)
      .set({
        reasons: sql`(select array(select distinct unnest(${moderationCase.reasons} || ${textArray(input.reasons)}) order by 1))`,
        severity: sql`greatest(${moderationCase.severity}, ${input.severity})`,
        detail: sql`coalesce(${moderationCase.detail}, '{}'::jsonb) || ${JSON.stringify({ [input.source]: input.detail ?? {} })}::jsonb`,
        ...(input.hide
          ? { hiddenAt: sql`coalesce(${moderationCase.hiddenAt}, ${now.toISOString()}::timestamptz)` }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, c.id)));
    await audit(tx, {
      tenantId: input.tenantId,
      actor: input.source === 'cosmos' ? { id: 'cosmos', kind: 'cosmos' } : { id: 'system', kind: 'system' },
      action: input.source === 'cosmos' ? 'cosmos.flag' : 'filter.hold',
      clocks: input.clocks,
      subjectProfileId: input.targetProfileId,
      caseId: c.id,
      reason: input.reasons.join(',') || null,
      content: input.content,
    });
    return { caseId: c.id };
  });
}

export interface QueueFilter {
  status?: 'open' | 'resolved' | 'dismissed';
  module?: string;
  room?: string;
  community?: string;
  source?: string;
  limit?: number;
}

/** A fila, por gravidade e depois pelo mais antigo. */
export async function listQueue(
  db: Database,
  tenantId: string,
  filter: QueueFilter = {},
): Promise<ModerationCaseView[]> {
  const rows = await db
    .select()
    .from(moderationCase)
    .where(
      and(
        eq(moderationCase.tenantId, tenantId),
        eq(moderationCase.status, filter.status ?? 'open'),
        ...(filter.module ? [eq(moderationCase.module, filter.module)] : []),
        ...(filter.room ? [eq(moderationCase.room, filter.room)] : []),
        ...(filter.community ? [eq(moderationCase.community, filter.community)] : []),
        ...(filter.source ? [eq(moderationCase.source, filter.source)] : []),
      ),
    )
    .orderBy(desc(moderationCase.severity), asc(moderationCase.createdAt))
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 200));
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    targetType: r.targetType,
    targetId: r.targetId,
    targetProfileId: r.targetProfileId,
    module: r.module,
    room: r.room,
    community: r.community,
    reasons: r.reasons,
    severity: r.severity,
    reportCount: r.reportCount,
    status: r.status,
    hiddenAt: r.hiddenAt,
    content: r.content,
    detail: r.detail ?? null,
    sanctionId: r.sanctionId,
    createdAt: r.createdAt,
  }));
}

/** Fecha o caso: `resolved` (houve ação) ou `dismissed` (sem ação; o conteúdo volta se estava oculto). */
export async function closeCase(
  db: Database,
  input: {
    tenantId: string;
    caseId: string;
    status: 'resolved' | 'dismissed';
    actor: ModerationActor;
    note: string | null;
    clocks: ModerationClocks;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(moderationCase)
      .set({
        status: input.status,
        resolvedAt: now,
        resolvedBy: input.actor.id,
        purgeAt: input.clocks.decisionPurgeAt,
        ...(input.status === 'dismissed' ? { hiddenAt: null } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(moderationCase.tenantId, input.tenantId),
          eq(moderationCase.id, input.caseId),
          eq(moderationCase.status, 'open'),
        ),
      )
      .returning({ id: moderationCase.id, targetProfileId: moderationCase.targetProfileId });
    if (!row) return false;
    await audit(tx, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: input.status === 'resolved' ? 'case.resolve' : 'case.dismiss',
      clocks: input.clocks,
      subjectProfileId: row.targetProfileId,
      caseId: row.id,
      reason: input.note,
    });
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Bloqueio

/** Bloqueia (idempotente). O Perfil bloqueado tem de ser do mesmo cliente: a FK composta recusa outro. */
export async function blockFan(
  db: Database,
  input: { tenantId: string; blockerProfileId: string; blockedProfileId: string },
): Promise<'blocked' | 'self'> {
  if (input.blockerProfileId === input.blockedProfileId) return 'self';
  await db.insert(fanBlock).values(input).onConflictDoNothing();
  return 'blocked';
}

export async function unblockFan(
  db: Database,
  input: { tenantId: string; blockerProfileId: string; blockedProfileId: string },
): Promise<boolean> {
  const rows = await db
    .delete(fanBlock)
    .where(
      and(
        eq(fanBlock.tenantId, input.tenantId),
        eq(fanBlock.blockerProfileId, input.blockerProfileId),
        eq(fanBlock.blockedProfileId, input.blockedProfileId),
      ),
    )
    .returning({ id: fanBlock.blockedProfileId });
  return rows.length > 0;
}

/** Quem o torcedor bloqueou, do mais recente ao mais antigo. */
export async function listBlocks(
  db: Database,
  tenantId: string,
  profileId: string,
  limit = 500,
): Promise<Array<{ profileId: string; createdAt: Date }>> {
  const rows = await db
    .select({ profileId: fanBlock.blockedProfileId, createdAt: fanBlock.createdAt })
    .from(fanBlock)
    .where(and(eq(fanBlock.tenantId, tenantId), eq(fanBlock.blockerProfileId, profileId)))
    .orderBy(desc(fanBlock.createdAt))
    .limit(limit);
  return rows;
}

/**
 * Perfis que este torcedor não vê: os que ele bloqueou e os que o bloquearam (o bloqueio vale nos dois sentidos para
 * a conversa). Os módulos (chat, mural, enquete) filtram por esta lista.
 */
export async function hiddenProfilesFor(
  db: Database,
  tenantId: string,
  profileId: string,
): Promise<string[]> {
  const rows = await db
    .select({ blocker: fanBlock.blockerProfileId, blocked: fanBlock.blockedProfileId })
    .from(fanBlock)
    .where(
      and(
        eq(fanBlock.tenantId, tenantId),
        or(eq(fanBlock.blockerProfileId, profileId), eq(fanBlock.blockedProfileId, profileId)),
      ),
    );
  return [...new Set(rows.map((r) => (r.blocker === profileId ? r.blocked : r.blocker)))];
}

// ---------------------------------------------------------------------------------------------------------------
// Punição

export interface SanctionView {
  id: string;
  profileId: string;
  accountId: string | null;
  level: string;
  hidden: boolean;
  scope: string;
  scopeId: string | null;
  reason: string;
  caseId: string | null;
  decidedBy: string;
  decidedByKind: string;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * Aplica um degrau da Escada. As regras (`checkSanction`, cargo pela matriz) já foram conferidas por quem chama;
 * o banco ainda recusa Silêncio oculto sem prazo ou pela Cosmos.
 */
export async function applySanction(
  db: Database,
  input: {
    tenantId: string;
    profileId: string;
    accountId: string | null;
    level: string;
    hidden: boolean;
    scope: string;
    scopeId: string | null;
    reason: string;
    caseId: string | null;
    actor: ModerationActor;
    endsAt: Date | null;
    clocks: ModerationClocks;
    rules?: Record<string, unknown>;
    now?: Date;
  },
): Promise<SanctionView> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(moderationSanction)
      .values({
        tenantId: input.tenantId,
        profileId: input.profileId,
        accountId: input.accountId,
        level: input.level,
        hidden: input.hidden,
        scope: input.scope,
        scopeId: input.scopeId,
        reason: input.reason,
        caseId: input.caseId,
        decidedBy: input.actor.id,
        decidedByKind: input.actor.kind,
        startsAt: now,
        endsAt: input.endsAt,
        purgeAt: input.clocks.decisionPurgeAt,
      })
      .returning();
    const s = row!;
    let content: string | null = null;
    if (input.caseId) {
      const [c] = await tx
        .select({ content: moderationCase.content })
        .from(moderationCase)
        .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, input.caseId)));
      content = c?.content ?? null;
    }
    await audit(tx, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: 'sanction',
      clocks: input.clocks,
      subjectProfileId: input.profileId,
      caseId: input.caseId,
      sanctionId: s.id,
      reason: input.reason,
      rules: { level: input.level, hidden: input.hidden, scope: input.scope, ...(input.rules ?? {}) },
      content,
    });
    return s as SanctionView;
  });
}

/** Punições que valem agora para o Perfil (ou para a Conta dele). */
export async function activeSanctions(
  db: Database,
  input: { tenantId: string; profileId: string; accountId: string | null; now?: Date },
): Promise<SanctionView[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(moderationSanction)
    .where(
      and(
        eq(moderationSanction.tenantId, input.tenantId),
        input.accountId
          ? or(
              eq(moderationSanction.profileId, input.profileId),
              eq(moderationSanction.accountId, input.accountId),
            )
          : eq(moderationSanction.profileId, input.profileId),
        isNull(moderationSanction.revokedAt),
        lte(moderationSanction.startsAt, now),
        or(isNull(moderationSanction.endsAt), gt(moderationSanction.endsAt, now)),
      ),
    )
    .orderBy(desc(moderationSanction.createdAt));
  return rows as SanctionView[];
}

/** Punições que o próprio torcedor vê: o Silêncio oculto não aparece (é a exceção ao aviso). */
export async function sanctionsForFan(
  db: Database,
  input: { tenantId: string; profileId: string; limit?: number },
): Promise<SanctionView[]> {
  const rows = await db
    .select()
    .from(moderationSanction)
    .where(
      and(
        eq(moderationSanction.tenantId, input.tenantId),
        eq(moderationSanction.profileId, input.profileId),
        eq(moderationSanction.hidden, false),
      ),
    )
    .orderBy(desc(moderationSanction.createdAt))
    .limit(input.limit ?? 50);
  return rows as SanctionView[];
}

// ---------------------------------------------------------------------------------------------------------------
// Apelação

export type FileAppealResult =
  | { ok: true; appealId: string; caseId: string; route: 'team' | 'galaxie' }
  | { ok: false; reason: 'not_found' | 'already' | 'hidden' };

/**
 * O punido pede revisão (uma vez por punição e etapa). A apelação entra na fila única como caso `appeal`, ou na fila
 * de segunda apelação da Galaxie (`route = galaxie`).
 */
export async function fileAppeal(
  db: Database,
  input: {
    tenantId: string;
    profileId: string;
    sanctionId: string;
    stage: 1 | 2;
    route: 'team' | 'galaxie';
    statement: string | null;
    dueAt: Date;
    clocks: ModerationClocks;
    severity: number;
    now?: Date;
  },
): Promise<FileAppealResult> {
  const now = input.now ?? new Date();
  return db
    .transaction(async (tx) => {
      const [s] = await tx
        .select({
          id: moderationSanction.id,
          hidden: moderationSanction.hidden,
          caseId: moderationSanction.caseId,
          module: moderationCase.module,
          room: moderationCase.room,
          community: moderationCase.community,
        })
        .from(moderationSanction)
        .leftJoin(
          moderationCase,
          and(
            eq(moderationCase.tenantId, moderationSanction.tenantId),
            eq(moderationCase.id, moderationSanction.caseId),
          ),
        )
        .where(
          and(
            eq(moderationSanction.tenantId, input.tenantId),
            eq(moderationSanction.id, input.sanctionId),
            eq(moderationSanction.profileId, input.profileId),
          ),
        );
      if (!s) return { ok: false, reason: 'not_found' } as const;
      // Silêncio oculto: o torcedor não sabe da punição, então não apela por ela
      if (s.hidden) return { ok: false, reason: 'hidden' } as const;
      const [c] = await tx
        .insert(moderationCase)
        .values({
          tenantId: input.tenantId,
          source: 'appeal',
          targetType: 'profile',
          targetId: input.profileId,
          targetProfileId: input.profileId,
          module: s.module ?? 'profile',
          room: s.room ?? null,
          community: s.community ?? null,
          severity: input.severity,
          sanctionId: s.id,
          detail: { stage: input.stage, route: input.route },
        })
        .returning({ id: moderationCase.id });
      try {
        const [a] = await tx
          .insert(moderationAppeal)
          .values({
            tenantId: input.tenantId,
            sanctionId: s.id,
            stage: input.stage,
            statement: input.statement,
            route: input.route,
            dueAt: input.dueAt,
            caseId: c!.id,
            createdAt: now,
          })
          .returning({ id: moderationAppeal.id });
        await audit(tx, {
          tenantId: input.tenantId,
          actor: { id: `fan:${input.profileId}`, kind: 'fan' },
          action: 'appeal',
          clocks: input.clocks,
          subjectProfileId: input.profileId,
          caseId: c!.id,
          sanctionId: s.id,
          appealId: a!.id,
          reason: `stage:${input.stage}`,
          content: input.statement,
        });
        return { ok: true, appealId: a!.id, caseId: c!.id, route: input.route } as const;
      } catch (err) {
        if (uniqueViolation(err, 'moderation_appeal_stage_uq')) throw new AppealExistsError();
        throw err;
      }
    })
    .catch((err) => {
      if (err instanceof AppealExistsError) return { ok: false, reason: 'already' } as const;
      throw err;
    });
}

class AppealExistsError extends Error {}

export interface AppealView {
  id: string;
  sanctionId: string;
  stage: number;
  status: string;
  route: string;
  dueAt: Date;
  decidedBy: string | null;
  decidedByKind: string | null;
  sanctionDecidedBy: string;
  sanctionDecidedByKind: string;
  profileId: string;
}

export async function readAppeal(
  db: Executor,
  tenantId: string,
  appealId: string,
): Promise<AppealView | null> {
  const [row] = await db
    .select({
      id: moderationAppeal.id,
      sanctionId: moderationAppeal.sanctionId,
      stage: moderationAppeal.stage,
      status: moderationAppeal.status,
      route: moderationAppeal.route,
      dueAt: moderationAppeal.dueAt,
      decidedBy: moderationAppeal.decidedBy,
      decidedByKind: moderationAppeal.decidedByKind,
      sanctionDecidedBy: moderationSanction.decidedBy,
      sanctionDecidedByKind: moderationSanction.decidedByKind,
      profileId: moderationSanction.profileId,
    })
    .from(moderationAppeal)
    .innerJoin(
      moderationSanction,
      and(
        eq(moderationSanction.tenantId, moderationAppeal.tenantId),
        eq(moderationSanction.id, moderationAppeal.sanctionId),
      ),
    )
    .where(and(eq(moderationAppeal.tenantId, tenantId), eq(moderationAppeal.id, appealId)));
  return row ?? null;
}

/** Quem julgou cada etapa da apelação desta punição (para impedir que julgue a seguinte). */
export async function appealJudges(
  db: Executor,
  tenantId: string,
  sanctionId: string,
): Promise<Array<{ stage: number; decidedBy: string | null; decidedByKind: string | null; status: string }>> {
  return db
    .select({
      stage: moderationAppeal.stage,
      decidedBy: moderationAppeal.decidedBy,
      decidedByKind: moderationAppeal.decidedByKind,
      status: moderationAppeal.status,
    })
    .from(moderationAppeal)
    .where(and(eq(moderationAppeal.tenantId, tenantId), eq(moderationAppeal.sanctionId, sanctionId)))
    .orderBy(asc(moderationAppeal.stage));
}

/** Apelações destas punições (para a lista do torcedor), por etapa. */
export async function appealsForSanctions(
  db: Executor,
  tenantId: string,
  sanctionIds: readonly string[],
): Promise<Array<{ id: string; sanctionId: string; stage: number; status: string; dueAt: Date }>> {
  if (sanctionIds.length === 0) return [];
  return db
    .select({
      id: moderationAppeal.id,
      sanctionId: moderationAppeal.sanctionId,
      stage: moderationAppeal.stage,
      status: moderationAppeal.status,
      dueAt: moderationAppeal.dueAt,
    })
    .from(moderationAppeal)
    .where(
      and(eq(moderationAppeal.tenantId, tenantId), inArray(moderationAppeal.sanctionId, [...sanctionIds])),
    )
    .orderBy(asc(moderationAppeal.stage));
}

/**
 * Decide a apelação: `upheld` mantém a punição, `overturned` revoga. Quem chama já conferiu `canJudgeAppeal`; aqui
 * a decisão só entra se a apelação ainda estiver pendente.
 */
export async function decideAppeal(
  db: Database,
  input: {
    tenantId: string;
    appealId: string;
    decision: 'upheld' | 'overturned';
    actor: ModerationActor;
    note: string | null;
    clocks: ModerationClocks;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [a] = await tx
      .update(moderationAppeal)
      .set({
        status: input.decision,
        decidedBy: input.actor.id,
        decidedByKind: input.actor.kind,
        decidedAt: now,
        decisionNote: input.note,
      })
      .where(
        and(
          eq(moderationAppeal.tenantId, input.tenantId),
          eq(moderationAppeal.id, input.appealId),
          eq(moderationAppeal.status, 'pending'),
        ),
      )
      .returning({
        id: moderationAppeal.id,
        sanctionId: moderationAppeal.sanctionId,
        caseId: moderationAppeal.caseId,
      });
    if (!a) return false;
    if (input.decision === 'overturned')
      await tx
        .update(moderationSanction)
        .set({ revokedAt: now, revokedBy: input.actor.id })
        .where(
          and(
            eq(moderationSanction.tenantId, input.tenantId),
            eq(moderationSanction.id, a.sanctionId),
            isNull(moderationSanction.revokedAt),
          ),
        );
    if (a.caseId)
      await tx
        .update(moderationCase)
        .set({
          status: 'resolved',
          resolvedAt: now,
          resolvedBy: input.actor.id,
          purgeAt: input.clocks.decisionPurgeAt,
          updatedAt: now,
        })
        .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, a.caseId)));
    const [s] = await tx
      .select({ profileId: moderationSanction.profileId })
      .from(moderationSanction)
      .where(and(eq(moderationSanction.tenantId, input.tenantId), eq(moderationSanction.id, a.sanctionId)));
    await audit(tx, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: 'appeal.decide',
      clocks: input.clocks,
      subjectProfileId: s?.profileId ?? null,
      caseId: a.caseId,
      sanctionId: a.sanctionId,
      appealId: a.id,
      reason: input.decision,
      content: input.note,
    });
    return true;
  });
}

/** Fila de segunda apelação da Galaxie (todos os clientes), pelo prazo. */
export async function galaxieAppealQueue(
  db: Database,
  limit = 100,
): Promise<Array<{ id: string; tenantId: string; sanctionId: string; dueAt: Date; createdAt: Date }>> {
  return db
    .select({
      id: moderationAppeal.id,
      tenantId: moderationAppeal.tenantId,
      sanctionId: moderationAppeal.sanctionId,
      dueAt: moderationAppeal.dueAt,
      createdAt: moderationAppeal.createdAt,
    })
    .from(moderationAppeal)
    .where(and(eq(moderationAppeal.route, 'galaxie'), eq(moderationAppeal.status, 'pending')))
    .orderBy(asc(moderationAppeal.dueAt))
    .limit(limit);
}

/** Apelações vencidas (para o alerta de prazo). */
export async function overdueAppeals(
  db: Database,
  tenantId: string,
  now: Date = new Date(),
): Promise<Array<{ id: string; dueAt: Date; route: string }>> {
  return db
    .select({ id: moderationAppeal.id, dueAt: moderationAppeal.dueAt, route: moderationAppeal.route })
    .from(moderationAppeal)
    .where(
      and(
        eq(moderationAppeal.tenantId, tenantId),
        eq(moderationAppeal.status, 'pending'),
        lte(moderationAppeal.dueAt, now),
      ),
    )
    .orderBy(asc(moderationAppeal.dueAt));
}

// ---------------------------------------------------------------------------------------------------------------
// Auditoria e guarda legal

export interface AuditRow {
  id: string;
  actor: string;
  actorKind: string;
  action: string;
  subjectProfileId: string | null;
  caseId: string | null;
  sanctionId: string | null;
  appealId: string | null;
  reason: string | null;
  rules: Record<string, unknown> | null;
  content: string | null;
  createdAt: Date;
}

/** Registro de auditoria do cliente, do mais recente. Só leitura: não existe função que apague. */
export async function readAudit(
  db: Database,
  tenantId: string,
  filter: { subjectProfileId?: string; caseId?: string; limit?: number } = {},
): Promise<AuditRow[]> {
  const rows = await db
    .select()
    .from(moderationAudit)
    .where(
      and(
        eq(moderationAudit.tenantId, tenantId),
        ...(filter.subjectProfileId ? [eq(moderationAudit.subjectProfileId, filter.subjectProfileId)] : []),
        ...(filter.caseId ? [eq(moderationAudit.caseId, filter.caseId)] : []),
      ),
    )
    .orderBy(desc(moderationAudit.createdAt), desc(moderationAudit.id))
    .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));
  return rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    actorKind: r.actorKind,
    action: r.action,
    subjectProfileId: r.subjectProfileId,
    caseId: r.caseId,
    sanctionId: r.sanctionId,
    appealId: r.appealId,
    reason: r.reason,
    rules: r.rules ?? null,
    content: r.content,
    createdAt: r.createdAt,
  }));
}

/**
 * Expurgo por relógio (D5), em todos os clientes: tira o conteúdo vencido (casos e auditoria) e apaga o que passou
 * do relógio de decisões (casos fechados, punições encerradas e a auditoria). Roda num job diário.
 */
export async function purgeModeration(
  db: Database,
  now: Date = new Date(),
): Promise<{ contents: number; cases: number; sanctions: number; audit: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local engage.moderation_purge = 'on'`);
    const contentCases = await tx
      .update(moderationCase)
      .set({ content: null, contentPurgeAt: null })
      .where(and(lte(moderationCase.contentPurgeAt, now), sql`${moderationCase.content} is not null`))
      .returning({ id: moderationCase.id });
    const contentAudit = await tx
      .update(moderationAudit)
      .set({ content: null })
      .where(and(lte(moderationAudit.contentPurgeAt, now), sql`${moderationAudit.content} is not null`))
      .returning({ id: moderationAudit.id });
    const cases = await tx
      .delete(moderationCase)
      .where(and(inArray(moderationCase.status, ['resolved', 'dismissed']), lte(moderationCase.purgeAt, now)))
      .returning({ id: moderationCase.id });
    // punição encerrada (fim ou revogação) que passou do relógio; a apelação cai em cascata
    const sanctions = await tx
      .delete(moderationSanction)
      .where(
        and(
          lte(moderationSanction.purgeAt, now),
          or(
            sql`${moderationSanction.revokedAt} is not null`,
            and(sql`${moderationSanction.endsAt} is not null`, lte(moderationSanction.endsAt, now)),
          ),
        ),
      )
      .returning({ id: moderationSanction.id });
    const auditRows = await tx
      .delete(moderationAudit)
      .where(lte(moderationAudit.purgeAt, now))
      .returning({ id: moderationAudit.id });
    return {
      contents: contentCases.length + contentAudit.length,
      cases: cases.length,
      sanctions: sanctions.length,
      audit: auditRows.length,
    };
  });
}

/**
 * Pedido de exclusão do torcedor: o conteúdo dele sai do ar na hora (casos e auditoria), e os bloqueios caem em
 * cascata com o Perfil. As decisões ficam, sem o conteúdo, até o relógio. Chamada dentro da transação da exclusão.
 */
export async function eraseModerationContent(
  tx: Executor,
  tenantId: string,
  profileId: string,
): Promise<void> {
  await tx.execute(sql`set local engage.moderation_erasure = 'on'`);
  await tx
    .update(moderationCase)
    .set({ content: null, contentPurgeAt: null })
    .where(
      and(
        eq(moderationCase.tenantId, tenantId),
        eq(moderationCase.targetProfileId, profileId),
        sql`${moderationCase.content} is not null`,
      ),
    );
  await tx
    .update(moderationAudit)
    .set({ content: null })
    .where(
      and(
        eq(moderationAudit.tenantId, tenantId),
        or(eq(moderationAudit.subjectProfileId, profileId), eq(moderationAudit.actor, `fan:${profileId}`)),
        sql`${moderationAudit.content} is not null`,
      ),
    );
  // a observação que o torcedor escreveu nas denúncias dele
  await tx
    .update(moderationReport)
    .set({ note: null })
    .where(
      and(
        eq(moderationReport.tenantId, tenantId),
        eq(moderationReport.reporterProfileId, profileId),
        sql`${moderationReport.note} is not null`,
      ),
    );
  await tx
    .delete(fanBlock)
    .where(
      and(
        eq(fanBlock.tenantId, tenantId),
        or(eq(fanBlock.blockerProfileId, profileId), eq(fanBlock.blockedProfileId, profileId)),
      ),
    );
}
