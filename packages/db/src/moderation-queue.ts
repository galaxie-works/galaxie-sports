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
import { settleAvatarsBeforePurge } from './fan-avatar-public.js';
import {
  fanBlock,
  moderationAppeal,
  moderationAudit,
  moderationCase,
  moderationNote,
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
  /** Prazo do item: o da apelação (padrão 72 h, #953); os outros casos não têm prazo próprio. */
  dueAt: Date | null;
  /** Suspeita de abuso infantil: a denúncia às autoridades vem antes de fechar (#1289). */
  childSafety: boolean;
  legalHoldUntil: Date | null;
  authorityReportedAt: Date | null;
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

/** A linha não está presa a um caso sob guarda legal em vigor (#1289). */
const heldCaseFree = (tenantCol: unknown, caseCol: unknown) =>
  sql`(${caseCol} is null or not exists (select 1 from ${moderationCase} hc where hc.tenant_id = ${tenantCol}
    and hc.id = ${caseCol} and hc.legal_hold_until > now()))`;

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
  return db
    .transaction(async (tx) => {
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
      // o autor do caso só barra a denúncia quando veio de fonte confiável (alvo Perfil, filtro ou Cosmos); o autor
      // que outro denunciante informou não impede a vítima de denunciar
      const [author] = await tx
        .select({
          id: moderationCase.targetProfileId,
          targetType: moderationCase.targetType,
          targetId: moderationCase.targetId,
          trusted: sql<boolean>`(${moderationCase.source} in ('filter', 'cosmos') or coalesce(${moderationCase.detail}, '{}'::jsonb) ?| array['filter', 'cosmos'])`,
        })
        .from(moderationCase)
        .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, c.id)));
      // alvo Perfil: o autor é o próprio Perfil denunciado
      if (author?.targetType === 'profile' && author.targetId === input.reporterProfileId)
        throw new SelfReportError();
      if (author?.trusted && author.id === input.reporterProfileId) throw new SelfReportError();
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
    })
    .catch((err) => {
      if (err instanceof SelfReportError) return { ok: false, reason: 'self_report' } as const;
      throw err;
    });
}

/**
 * Conteúdo segurado pelo filtro (B7) ou sugerido pela Cosmos (#998, #999): entra na mesma fila, no caso aberto do
 * conteúdo se já houver. `hide` oculta até a revisão (o filtro já não publicou).
 */
export async function holdContent(
  db: Executor,
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
  // dentro de outra transação (ex.: o pedido do token, #1105) vira savepoint: o caso entra junto ou nada entra
  return (db as Database).transaction(async (tx) => {
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
        // o autor que o filtro ou a Cosmos viu vale por cima do que um denunciante informou
        ...(input.targetProfileId ? { targetProfileId: input.targetProfileId } : {}),
        ...(input.content
          ? {
              content: sql`coalesce(${moderationCase.content}, ${input.content})`,
              contentPurgeAt: sql`coalesce(${moderationCase.contentPurgeAt}, ${input.clocks.contentPurgeAt.toISOString()}::timestamptz)`,
            }
          : {}),
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

/**
 * Evento do Perfil que não é caso da fila, só auditoria (ex.: autorização do responsável declarada pelo cliente,
 * #1105). Os mesmos relógios da ficha do país.
 */
export async function auditFanEvent(
  db: Executor,
  row: {
    tenantId: string;
    actor: ModerationActor;
    action: string;
    clocks: ModerationClocks;
    subjectProfileId: string;
    reason?: string | null;
    rules?: Record<string, unknown> | null;
  },
): Promise<void> {
  await audit(db, row);
}

/**
 * Decisão que não abre caso nem pune (a Cosmos leu e deixou publicado; o lote caiu e o texto seguiu as regras): só a
 * linha da auditoria, com o relógio de decisões da ficha (#954, D5).
 */
export async function recordModerationDecision(
  db: Database,
  input: {
    tenantId: string;
    actor: ModerationActor;
    action: string;
    clocks: ModerationClocks;
    subjectProfileId?: string | null;
    caseId?: string | null;
    reason?: string | null;
    rules?: Record<string, unknown> | null;
    content?: string | null;
  },
): Promise<void> {
  await audit(db, input);
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
    .select({ c: moderationCase, dueAt: moderationAppeal.dueAt })
    .from(moderationCase)
    .leftJoin(
      moderationAppeal,
      and(
        eq(moderationAppeal.tenantId, moderationCase.tenantId),
        eq(moderationAppeal.caseId, moderationCase.id),
      ),
    )
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
  return rows.map(({ c: r, dueAt }) => ({
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
    dueAt,
    childSafety: r.childSafety,
    legalHoldUntil: r.legalHoldUntil,
    authorityReportedAt: r.authorityReportedAt,
  }));
}

/** Um caso da fila, do cliente (null se não existe ou é de outro cliente). */
export async function readCase(
  db: Database,
  tenantId: string,
  caseId: string,
): Promise<(ModerationCaseView & { resolvedBy: string | null; resolvedAt: Date | null }) | null> {
  const [row] = await db
    .select({ c: moderationCase, dueAt: moderationAppeal.dueAt })
    .from(moderationCase)
    .leftJoin(
      moderationAppeal,
      and(
        eq(moderationAppeal.tenantId, moderationCase.tenantId),
        eq(moderationAppeal.caseId, moderationCase.id),
      ),
    )
    .where(and(eq(moderationCase.tenantId, tenantId), eq(moderationCase.id, caseId)));
  if (!row) return null;
  const r = row.c;
  return {
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
    dueAt: row.dueAt,
    childSafety: r.childSafety,
    legalHoldUntil: r.legalHoldUntil,
    authorityReportedAt: r.authorityReportedAt,
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt,
  };
}

/** Punições automáticas (Cosmos ou filtro) ainda ativas de um caso: quem desfaz precisa poder aplicar cada uma. */
export async function automaticSanctionsOf(
  db: Pick<Database, 'select'>,
  tenantId: string,
  caseId: string,
  now: Date = new Date(),
): Promise<{ id: string; level: string; hidden: boolean; endsAt: Date | null }[]> {
  return db
    .select({
      id: moderationSanction.id,
      level: moderationSanction.level,
      hidden: moderationSanction.hidden,
      endsAt: moderationSanction.endsAt,
    })
    .from(moderationSanction)
    .where(
      and(
        eq(moderationSanction.tenantId, tenantId),
        eq(moderationSanction.caseId, caseId),
        inArray(moderationSanction.decidedByKind, ['cosmos', 'system']),
        isNull(moderationSanction.revokedAt),
        or(isNull(moderationSanction.endsAt), gt(moderationSanction.endsAt, now)),
      ),
    );
}

export type UndoResult =
  | { ok: true; revoked: number }
  | { ok: false; reason: 'not_found' | 'not_automatic' | 'appeal' | 'legal_hold' };

/**
 * Desfaz uma decisão automática (filtro ou Cosmos, #999): o conteúdo volta ao ar, as punições do caso aplicadas pela
 * Cosmos são revogadas e o caso fecha como `dismissed`. A decisão original continua na auditoria, e o desfazer entra
 * junto (`undo`, e `revoke` por punição). Decisão de pessoa não se desfaz por aqui: vai por apelação.
 */
export async function undoDecision(
  db: Database,
  input: {
    tenantId: string;
    caseId: string;
    actor: ModerationActor;
    note: string | null;
    clocks: ModerationClocks;
    now?: Date;
  },
): Promise<UndoResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({
        id: moderationCase.id,
        source: moderationCase.source,
        status: moderationCase.status,
        resolvedBy: moderationCase.resolvedBy,
        targetProfileId: moderationCase.targetProfileId,
        automatic: sql<boolean>`coalesce(${moderationCase.detail}, '{}'::jsonb) ?| array['filter', 'cosmos']`,
        held: sql<boolean>`${moderationCase.childSafety} or coalesce(${moderationCase.legalHoldUntil} > now(), false)`,
      })
      .from(moderationCase)
      .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, input.caseId)))
      .for('update');
    if (!c) return { ok: false, reason: 'not_found' } as const;
    if (c.source === 'appeal') return { ok: false, reason: 'appeal' } as const;
    // abuso infantil ou guarda legal (#1289): o conteúdo não volta ao ar por aqui
    if (c.held) return { ok: false, reason: 'legal_hold' } as const;
    // fechado por pessoa: a decisão é dela, e o caminho é a apelação
    const byPerson = c.status !== 'open' && c.resolvedBy !== 'cosmos' && c.resolvedBy !== 'system';
    if (!c.automatic || byPerson) return { ok: false, reason: 'not_automatic' } as const;

    const revoked = await tx
      .update(moderationSanction)
      .set({ revokedAt: now, revokedBy: input.actor.id })
      .where(
        and(
          eq(moderationSanction.tenantId, input.tenantId),
          eq(moderationSanction.caseId, c.id),
          inArray(moderationSanction.decidedByKind, ['cosmos', 'system']),
          isNull(moderationSanction.revokedAt),
        ),
      )
      .returning({ id: moderationSanction.id, profileId: moderationSanction.profileId });
    for (const s of revoked)
      await audit(tx, {
        tenantId: input.tenantId,
        actor: input.actor,
        action: 'revoke',
        clocks: input.clocks,
        subjectProfileId: s.profileId,
        caseId: c.id,
        sanctionId: s.id,
        // a nota de quem desfez é texto livre: vai em `content`, que a exclusão do torcedor apaga
        reason: 'undo',
        content: input.note,
      });
    await tx
      .update(moderationCase)
      .set({
        status: 'dismissed',
        hiddenAt: null,
        resolvedAt: now,
        resolvedBy: input.actor.id,
        purgeAt: input.clocks.decisionPurgeAt,
        updatedAt: now,
      })
      .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, c.id)));
    await audit(tx, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: 'undo',
      clocks: input.clocks,
      subjectProfileId: c.targetProfileId,
      caseId: c.id,
      reason: 'undo',
      content: input.note,
      rules: { revoked: revoked.length, previous: c.status },
    });
    return { ok: true, revoked: revoked.length } as const;
  });
}

/**
 * Fecha o caso: `resolved` (houve ação) ou `dismissed` (sem ação; o conteúdo volta se estava oculto). Com `hide`, o
 * `resolved` também tira o conteúdo do ar (a equipe removeu da fila), com a linha `hide` na auditoria quando ele ainda
 * estava no ar. `reason` é um código fixo (a auditoria não muda depois); a nota livre de quem decidiu vai em `content`,
 * que a exclusão do torcedor apaga. false = o caso não estava mais aberto (outra pessoa decidiu antes).
 */
export async function closeCase(
  db: Executor,
  input: {
    tenantId: string;
    caseId: string;
    status: 'resolved' | 'dismissed';
    actor: ModerationActor;
    /** Código fixo (`queue.remove`, a régua da Cosmos); nunca texto livre. */
    reason?: string | null;
    /** Texto livre de quem decidiu. */
    note: string | null;
    clocks: ModerationClocks;
    hide?: boolean;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: moderationCase.status, hiddenAt: moderationCase.hiddenAt })
      .from(moderationCase)
      .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, input.caseId)))
      .for('update');
    if (!before || before.status !== 'open') return false;
    const [row] = await tx
      .update(moderationCase)
      .set({
        status: input.status,
        resolvedAt: now,
        resolvedBy: input.actor.id,
        purgeAt: input.clocks.decisionPurgeAt,
        // abuso infantil (#1289): o conteúdo marcado não volta ao ar nem ao descartar
        ...(input.status === 'dismissed'
          ? { hiddenAt: sql`case when ${moderationCase.childSafety} then ${moderationCase.hiddenAt} end` }
          : {}),
        ...(input.status === 'resolved' && input.hide
          ? { hiddenAt: sql`coalesce(${moderationCase.hiddenAt}, ${now.toISOString()}::timestamptz)` }
          : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(moderationCase.tenantId, input.tenantId),
          eq(moderationCase.id, input.caseId),
          eq(moderationCase.status, 'open'),
          // abuso infantil (#1289): a denúncia às autoridades vem antes de fechar, por qualquer caminho
          sql`(not ${moderationCase.childSafety} or ${moderationCase.authorityReportedAt} is not null)`,
        ),
      )
      .returning({ id: moderationCase.id, targetProfileId: moderationCase.targetProfileId });
    if (!row) return false;
    const reason = input.reason ?? null;
    if (input.status === 'resolved' && input.hide && !before.hiddenAt)
      await audit(tx, {
        tenantId: input.tenantId,
        actor: input.actor,
        action: 'hide',
        clocks: input.clocks,
        subjectProfileId: row.targetProfileId,
        caseId: row.id,
        reason,
      });
    await audit(tx, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: input.status === 'resolved' ? 'case.resolve' : 'case.dismiss',
      clocks: input.clocks,
      subjectProfileId: row.targetProfileId,
      caseId: row.id,
      reason,
      content: input.note,
    });
    return true;
  });
}

/**
 * A faixa congelada voltou a adulto com uma comprovação nova (#1110). O caso aberto só por `age_band_downgrade` é
 * fechado como `resolved`, com o código fixo `age.reassured`. O caso que juntou também denúncias de outro motivo
 * (spam, ameaça) continua aberto, só sem o motivo de idade: a equipe ainda precisa ver o resto. Devolve quantos fechou.
 */
export async function closeAgeDowngradeCases(
  db: Executor,
  input: {
    tenantId: string;
    profileId: string;
    actor: ModerationActor;
    clocks: ModerationClocks;
    now?: Date;
  },
): Promise<number> {
  const open = await db
    .select({ id: moderationCase.id, reasons: moderationCase.reasons })
    .from(moderationCase)
    .where(
      and(
        eq(moderationCase.tenantId, input.tenantId),
        eq(moderationCase.targetProfileId, input.profileId),
        eq(moderationCase.status, 'open'),
        sql`'age_band_downgrade' = any(${moderationCase.reasons})`,
      ),
    )
    .for('update');
  let closed = 0;
  for (const c of open) {
    if (c.reasons.some((r) => r !== 'age_band_downgrade')) {
      await db
        .update(moderationCase)
        .set({
          reasons: sql`array_remove(${moderationCase.reasons}, 'age_band_downgrade')`,
          updatedAt: input.now ?? new Date(),
        })
        .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, c.id)));
      continue;
    }
    if (
      await closeCase(db, {
        tenantId: input.tenantId,
        caseId: c.id,
        status: 'resolved',
        actor: input.actor,
        reason: 'age.reassured',
        note: null,
        clocks: input.clocks,
        ...(input.now ? { now: input.now } : {}),
      })
    )
      closed++;
  }
  return closed;
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
  db: Executor,
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
    // a punição aponta para o caso de origem; caso de apelação não (o expurgo da apelação levaria o caso junto)
    if (input.caseId) {
      const [origin] = await tx
        .select({ source: moderationCase.source })
        .from(moderationCase)
        .where(and(eq(moderationCase.tenantId, input.tenantId), eq(moderationCase.id, input.caseId)));
      if (origin?.source === 'appeal') throw new Error('punição não pode apontar para caso de apelação');
    }
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
  input: { tenantId: string; profileId: string; accountId: string | null; limit?: number },
): Promise<SanctionView[]> {
  const rows = await db
    .select()
    .from(moderationSanction)
    .where(
      and(
        eq(moderationSanction.tenantId, input.tenantId),
        // a punição estendida à Conta vale (e aparece) para todos os Perfis dela
        input.accountId
          ? or(
              eq(moderationSanction.profileId, input.profileId),
              eq(moderationSanction.accountId, input.accountId),
            )
          : eq(moderationSanction.profileId, input.profileId),
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
  | { ok: false; reason: 'not_found' | 'already' | 'hidden' | 'closed' };

/**
 * O punido pede revisão (uma vez por punição e etapa). A apelação entra na fila única como caso `appeal`, ou na fila
 * de segunda apelação da Galaxie (`route = galaxie`).
 */
export async function fileAppeal(
  db: Database,
  input: {
    tenantId: string;
    profileId: string;
    /** Conta do Perfil: a punição estendida à Conta também é apelável pelos Perfis dela. */
    accountId: string | null;
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
          revokedAt: moderationSanction.revokedAt,
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
            input.accountId
              ? or(
                  eq(moderationSanction.profileId, input.profileId),
                  eq(moderationSanction.accountId, input.accountId),
                )
              : eq(moderationSanction.profileId, input.profileId),
          ),
        );
      if (!s) return { ok: false, reason: 'not_found' } as const;
      // Silêncio oculto: o torcedor não sabe da punição, então não apela por ela
      if (s.hidden) return { ok: false, reason: 'hidden' } as const;
      // punição já revogada: não há o que apelar
      if (s.revokedAt) return { ok: false, reason: 'closed' } as const;
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
class SelfReportError extends Error {}

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
 * Decide a apelação: `upheld` mantém a punição, `overturned` revoga. A decisão só entra se a apelação estiver
 * pendente (`not_pending`) e se quem julga não aplicou a punição nem julgou a etapa anterior (`forbidden`); a
 * segunda etapa nunca é da Cosmos.
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
): Promise<'decided' | 'not_pending' | 'forbidden'> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // quem julga: nunca quem aplicou a punição nem quem julgou a etapa anterior; a segunda etapa nunca é da Cosmos
    const [current] = await tx
      .select({
        stage: moderationAppeal.stage,
        status: moderationAppeal.status,
        route: moderationAppeal.route,
        appliedBy: moderationSanction.decidedBy,
        sanctionId: moderationAppeal.sanctionId,
      })
      .from(moderationAppeal)
      .innerJoin(
        moderationSanction,
        and(
          eq(moderationSanction.tenantId, moderationAppeal.tenantId),
          eq(moderationSanction.id, moderationAppeal.sanctionId),
        ),
      )
      .where(and(eq(moderationAppeal.tenantId, input.tenantId), eq(moderationAppeal.id, input.appealId)))
      .for('update');
    if (!current || current.status !== 'pending') return 'not_pending' as const;
    if (current.stage === 2 && input.actor.kind === 'cosmos') return 'forbidden' as const;
    // fila da Galaxie: só a equipe da Galaxie decide
    if (current.route === 'galaxie' && input.actor.kind !== 'galaxie') return 'forbidden' as const;
    if (input.actor.id === current.appliedBy) return 'forbidden' as const;
    if (current.stage === 2) {
      const [prev] = await tx
        .select({ decidedBy: moderationAppeal.decidedBy })
        .from(moderationAppeal)
        .where(
          and(
            eq(moderationAppeal.tenantId, input.tenantId),
            eq(moderationAppeal.sanctionId, current.sanctionId),
            eq(moderationAppeal.stage, 1),
          ),
        );
      if (prev?.decidedBy === input.actor.id) return 'forbidden' as const;
    }
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
    if (!a) return 'not_pending' as const;
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
    return 'decided' as const;
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

export interface DecisionFilter {
  module?: string;
  room?: string;
  community?: string;
  /** Categoria da decisão (régua da Cosmos) ou motivo do caso. */
  category?: string;
  action?: string;
  /** Quem decidiu: `person`, `cosmos`, `system`... */
  actorKind?: string;
  /** Uma pessoa (`user:<id>`). */
  actor?: string;
  from?: Date;
  to?: Date;
  /** Paginação: linhas mais antigas que este id (UUIDv7, em ordem de criação). */
  before?: string;
  limit?: number;
}

/** Lugar da decisão: o do caso; sem caso (`cosmos.allow`, `cosmos.skip`), o que a Cosmos gravou na régua. */
const placeModule = sql<
  string | null
>`coalesce(${moderationCase.module}, ${moderationAudit.rules}->>'module')`;
const placeRoom = sql<string | null>`coalesce(${moderationCase.room}, ${moderationAudit.rules}->>'room')`;
const placeCommunity = sql<
  string | null
>`coalesce(${moderationCase.community}, ${moderationAudit.rules}->>'community')`;

export type DecisionRow = AuditRow & { module: string | null; room: string | null; community: string | null };

/**
 * Histórico de decisões (#999): a auditoria do cliente com o lugar do caso (módulo, sala, comunidade), do mais recente,
 * com os filtros da tela. Inclui as decisões automáticas (Cosmos, filtro) e as das pessoas.
 */
export async function listDecisions(
  db: Database,
  tenantId: string,
  filter: DecisionFilter = {},
): Promise<DecisionRow[]> {
  const rows = await db
    .select({
      a: moderationAudit,
      module: placeModule,
      room: placeRoom,
      community: placeCommunity,
    })
    .from(moderationAudit)
    .leftJoin(
      moderationCase,
      and(
        eq(moderationCase.tenantId, moderationAudit.tenantId),
        eq(moderationCase.id, moderationAudit.caseId),
      ),
    )
    .where(
      and(
        eq(moderationAudit.tenantId, tenantId),
        ...(filter.module ? [eq(placeModule, filter.module)] : []),
        ...(filter.room ? [eq(placeRoom, filter.room)] : []),
        ...(filter.community ? [eq(placeCommunity, filter.community)] : []),
        ...(filter.category
          ? [
              or(
                sql`${moderationAudit.rules}->>'category' = ${filter.category}`,
                sql`${filter.category} = any(${moderationCase.reasons})`,
              ),
            ]
          : []),
        ...(filter.action ? [eq(moderationAudit.action, filter.action)] : []),
        ...(filter.actorKind ? [eq(moderationAudit.actorKind, filter.actorKind)] : []),
        ...(filter.actor ? [eq(moderationAudit.actor, filter.actor)] : []),
        ...(filter.from ? [gte(moderationAudit.createdAt, filter.from)] : []),
        ...(filter.to ? [lte(moderationAudit.createdAt, filter.to)] : []),
        ...(filter.before ? [sql`${moderationAudit.id} < ${filter.before}::uuid`] : []),
      ),
    )
    .orderBy(desc(moderationAudit.id))
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 200));
  return rows.map(({ a: r, module, room, community }) => ({
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
    module,
    room,
    community,
  }));
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
 * Expurgo por relógio (D5), em todos os clientes, num job diário. Usa o relógio do banco (o mesmo do gatilho da
 * auditoria). Ordem:
 *
 * 1. tira o conteúdo vencido (casos e auditoria);
 * 2. apaga a punição encerrada (fim ou revogação) quando o relógio de decisões passou, contado do encerramento, e
 *    sem apelação pendente; a apelação e o caso dela saem em cascata;
 * 3. apaga o caso fechado vencido que nenhuma punição usa;
 * 4. apaga a auditoria vencida cuja punição e cujo caso já saíram.
 *
 * Punição em vigor (ban sem prazo, por exemplo) segura a auditoria e o caso dela.
 */
export async function purgeModeration(
  db: Database,
): Promise<{ contents: number; cases: number; sanctions: number; audit: number; notes: number }> {
  return db.transaction(async (tx) => {
    // uma réplica por vez (a API roda de hora em hora em todas): quem não pega a trava sai sem fazer nada
    const [lock] = await tx.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended('engage.moderation:purge', 0)) as ok`,
    );
    if (!lock?.ok) return { contents: 0, cases: 0, sanctions: 0, audit: 0, notes: 0 };
    await tx.execute(sql`set local engage.moderation_purge = 'on'`);
    // caso ainda na fila ou com apelação pendente guarda a prova até a decisão
    const contentCases = await tx
      .update(moderationCase)
      .set({ content: null, contentPurgeAt: null })
      .where(
        and(
          sql`${moderationCase.contentPurgeAt} <= now()`,
          sql`${moderationCase.content} is not null`,
          sql`${moderationCase.status} <> 'open'`,
          // guarda legal (#1289): o conteúdo denunciado fica até o fim dela
          sql`(${moderationCase.legalHoldUntil} is null or ${moderationCase.legalHoldUntil} <= now())`,
          sql`not exists (select 1 from ${moderationAppeal} a where a.tenant_id = ${moderationCase.tenantId}
            and a.case_id = ${moderationCase.id} and a.status = 'pending')`,
        ),
      )
      .returning({ id: moderationCase.id });
    const contentAudit = await tx
      .update(moderationAudit)
      .set({ content: null })
      .where(
        and(
          sql`${moderationAudit.contentPurgeAt} <= now()`,
          sql`${moderationAudit.content} is not null`,
          heldCaseFree(moderationAudit.tenantId, moderationAudit.caseId),
        ),
      )
      .returning({ id: moderationAudit.id });
    // o prazo da decisão (purge_at − created_at) conta a partir do encerramento da punição; a Advertência não tem
    // fim e se encerra ao ser dada
    const sanctions = await tx
      .delete(moderationSanction)
      .where(
        and(
          sql`coalesce(least(${moderationSanction.revokedAt}, ${moderationSanction.endsAt}), case when ${moderationSanction.level} = 'warning' then ${moderationSanction.startsAt} end) <= now()`,
          sql`coalesce(least(${moderationSanction.revokedAt}, ${moderationSanction.endsAt}), case when ${moderationSanction.level} = 'warning' then ${moderationSanction.startsAt} end) + (${moderationSanction.purgeAt} - ${moderationSanction.createdAt}) <= now()`,
          sql`not exists (select 1 from ${moderationAppeal} a where a.tenant_id = ${moderationSanction.tenantId}
            and a.sanction_id = ${moderationSanction.id} and a.status = 'pending')`,
          heldCaseFree(moderationSanction.tenantId, moderationSanction.caseId),
        ),
      )
      .returning({ id: moderationSanction.id });
    // foto de perfil (#1025): o caso que sai levava a decisão da equipe; ela fica gravada no Perfil
    await tx.execute(
      settleAvatarsBeforePurge(
        sql`${moderationCase.status} in ('resolved', 'dismissed') and ${moderationCase.sanctionId} is null
          and ${moderationCase.purgeAt} <= now()`,
      ),
    );
    const cases = await tx
      .delete(moderationCase)
      .where(
        and(
          inArray(moderationCase.status, ['resolved', 'dismissed']),
          // caso de apelação só sai com a punição (cascata): senão a etapa poderia ser pedida de novo
          isNull(moderationCase.sanctionId),
          sql`${moderationCase.purgeAt} <= now()`,
          sql`(${moderationCase.legalHoldUntil} is null or ${moderationCase.legalHoldUntil} <= now())`,
          sql`not exists (select 1 from ${moderationSanction} s where s.tenant_id = ${moderationCase.tenantId}
            and s.case_id = ${moderationCase.id})`,
        ),
      )
      .returning({ id: moderationCase.id });
    const auditRows = await tx
      .delete(moderationAudit)
      .where(
        and(
          sql`${moderationAudit.purgeAt} <= now()`,
          sql`(${moderationAudit.sanctionId} is null or not exists (select 1 from ${moderationSanction} s
            where s.tenant_id = ${moderationAudit.tenantId} and s.id = ${moderationAudit.sanctionId}))`,
          sql`(${moderationAudit.caseId} is null or not exists (select 1 from ${moderationCase} c
            where c.tenant_id = ${moderationAudit.tenantId} and c.id = ${moderationAudit.caseId}))`,
          heldCaseFree(moderationAudit.tenantId, moderationAudit.caseId),
        ),
      )
      .returning({ id: moderationAudit.id });
    // no relógio, e as de torcedor excluído que tenham entrado junto com a exclusão
    const notes = await tx
      .delete(moderationNote)
      .where(
        or(
          sql`${moderationNote.purgeAt} <= now()`,
          sql`exists (select 1 from fan.profile p where p.tenant_id = ${moderationNote.tenantId}
            and p.id = ${moderationNote.profileId} and p.deleted_at is not null)`,
        ),
      )
      .returning({ id: moderationNote.id });
    return {
      contents: contentCases.length + contentAudit.length,
      cases: cases.length,
      sanctions: sanctions.length,
      audit: auditRows.length,
      notes: notes.length,
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
  // o conteúdo sob guarda legal (#1289) fica até o fim dela: a exclusão do titular tem essa exceção na lei
  await tx
    .update(moderationCase)
    .set({ content: null, contentPurgeAt: null })
    .where(
      and(
        eq(moderationCase.tenantId, tenantId),
        eq(moderationCase.targetProfileId, profileId),
        sql`${moderationCase.content} is not null`,
        sql`(${moderationCase.legalHoldUntil} is null or ${moderationCase.legalHoldUntil} <= now())`,
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
        heldCaseFree(moderationAudit.tenantId, moderationAudit.caseId),
      ),
    );
  // o que o filtro ou a Cosmos guardaram do conteúdo dele
  await tx
    .update(moderationCase)
    .set({ detail: null })
    .where(
      and(
        eq(moderationCase.tenantId, tenantId),
        eq(moderationCase.targetProfileId, profileId),
        sql`${moderationCase.detail} is not null`,
        sql`(${moderationCase.legalHoldUntil} is null or ${moderationCase.legalHoldUntil} <= now())`,
      ),
    );
  // o que ele escreveu nas apelações
  await tx
    .update(moderationAppeal)
    .set({ statement: null })
    .where(
      and(
        eq(moderationAppeal.tenantId, tenantId),
        sql`${moderationAppeal.statement} is not null`,
        inArray(
          moderationAppeal.sanctionId,
          tx
            .select({ id: moderationSanction.id })
            .from(moderationSanction)
            .where(
              and(eq(moderationSanction.tenantId, tenantId), eq(moderationSanction.profileId, profileId)),
            ),
        ),
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
  // o que a equipe anotou sobre ele (ficha do usuário, #973)
  await tx
    .delete(moderationNote)
    .where(and(eq(moderationNote.tenantId, tenantId), eq(moderationNote.profileId, profileId)));
}

// ---------------------------------------------------------------------------------------------------------------
// Notas internas da ficha do usuário (#973)

export interface ModerationNoteRow {
  id: string;
  body: string;
  author: string;
  createdAt: Date;
}

/**
 * Nota interna da equipe sobre o torcedor. Só entra: corrigir é escrever outra. Perfil excluído não recebe nota
 * (null): a checagem e a gravação são um comando só, e o expurgo varre o que escapar de uma exclusão simultânea.
 */
export async function addModerationNote(
  db: Executor,
  input: { tenantId: string; profileId: string; body: string; author: string; purgeAt: Date },
): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into engage.moderation_note (tenant_id, profile_id, body, author, purge_at)
    select ${input.tenantId}, ${input.profileId}, ${input.body}, ${input.author}, ${input.purgeAt.toISOString()}::timestamptz
     where exists (select 1 from fan.profile p
                    where p.tenant_id = ${input.tenantId} and p.id = ${input.profileId} and p.deleted_at is null)
    returning id`);
  return (rows as unknown as Array<{ id: string }>)[0]?.id ?? null;
}

/** Notas do torcedor, da mais recente para a mais antiga. */
export async function moderationNotesFor(
  db: Executor,
  tenantId: string,
  profileId: string,
  limit = 100,
): Promise<ModerationNoteRow[]> {
  return db
    .select({
      id: moderationNote.id,
      body: moderationNote.body,
      author: moderationNote.author,
      createdAt: moderationNote.createdAt,
    })
    .from(moderationNote)
    .where(and(eq(moderationNote.tenantId, tenantId), eq(moderationNote.profileId, profileId)))
    .orderBy(desc(moderationNote.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------------------------------------------
// Guarda legal e denúncia às autoridades (#1289)

/** Leva a guarda à mensagem do chat do caso (tirada do ar e presa até o fim da guarda). */
async function holdChatMessage(
  tx: Executor,
  tenantId: string,
  messageId: string,
  until: Date,
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) return;
  const id = messageId.toLowerCase();
  // a fixada denunciada sai do topo da sala
  await tx.execute(sql`
    update chat.room set pinned_message_id = null, pinned_by = null, pinned_at = null, updated_at = now()
     where tenant_id = ${tenantId} and pinned_message_id = ${id}::uuid`);
  await tx.execute(sql`
    update chat.message
       set legal_hold_until = greatest(coalesce(legal_hold_until, ${until.toISOString()}::timestamptz),
                                       ${until.toISOString()}::timestamptz),
           flags = case when visibility = 'shadow' and not ('was_shadow' = any(flags))
                        then array_append(flags, 'was_shadow') else flags end,
           visibility = 'hidden'
     where tenant_id = ${tenantId} and id = ${id}::uuid`);
}

/**
 * Leva a guarda ao post ou comentário de Comunidade do caso (#946): tirado do ar, desafixado e preso até o fim da
 * guarda (o expurgo pelo relógio da ficha não apaga antes).
 */
async function holdCommunityContent(
  tx: Executor,
  tenantId: string,
  kind: 'post' | 'comment',
  contentId: string,
  until: Date,
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contentId)) return;
  const id = contentId.toLowerCase();
  const table = kind === 'post' ? 'community.post' : 'community.comment';
  const unpin = kind === 'post' ? sql`, pinned_at = null, pinned_by = null` : sql``;
  await tx.execute(sql`
    update ${sql.raw(table)}
       set legal_hold_until = greatest(coalesce(legal_hold_until, ${until.toISOString()}::timestamptz),
                                       ${until.toISOString()}::timestamptz),
           flags = case when visibility = 'shadow' and not ('was_shadow' = any(flags))
                        then array_append(flags, 'was_shadow') else flags end,
           visibility = 'hidden'${unpin}
     where tenant_id = ${tenantId} and id = ${id}::uuid`);
}

/** A guarda vai ao conteúdo do caso, no módulo dele. */
async function holdCaseContent(
  tx: Executor,
  tenantId: string,
  c: { module: string | null; targetType: string; targetId: string; targetProfileId?: string | null },
  until: Date,
  caseId?: string,
): Promise<void> {
  if (c.module === 'chat' && c.targetType === 'message')
    await holdChatMessage(tx, tenantId, c.targetId, until);
  if (c.module === 'communities' && (c.targetType === 'post' || c.targetType === 'comment'))
    await holdCommunityContent(tx, tenantId, c.targetType, c.targetId, until);
  // a foto do autor vai junto em todo caso com autor (Perfil, foto barrada, mensagem, post)
  if (caseId && c.targetProfileId) await copyProfileEvidence(tx, tenantId, caseId);
}

/**
 * Prova fora do chat (#1296): a foto do Perfil é a prova principal em abuso infantil, mas a troca da foto e a exclusão
 * do titular apagam a foto do Perfil. Na guarda, o caso copia para `detail.evidence` a URL, a referência, o hash, o
 * estado da foto e o apelido do autor (`target_profile_id`). `same_photo` diz se é a mesma foto do caso (o caso da
 * foto barrada guarda a referência dela em `target_id`); a primeira cópia vale, e Perfil sem foto não grava prova vazia.
 */
async function copyProfileEvidence(tx: Executor, tenantId: string, caseId: string) {
  await (tx as Database).execute(sql`
    update engage.moderation_case c
       set detail = coalesce(c.detail, '{}'::jsonb) || jsonb_build_object(
             'evidence',
             jsonb_build_object(
               'avatar_url', p.avatar_url,
               'avatar_ref', p.avatar_ref,
               'avatar_hash', p.avatar_hash,
               'avatar_status', p.avatar_status,
               'same_photo', c.target_type <> 'profile' or p.avatar_ref = c.target_id or p.id::text = c.target_id,
               'nickname', p.nickname,
               'copied_at', now()
             )
           )
      from fan.profile p
     where c.tenant_id = ${tenantId} and c.id = ${caseId}
       and p.tenant_id = c.tenant_id and p.id = c.target_profile_id
       and (p.avatar_url is not null or p.avatar_ref is not null)
       and not (coalesce(c.detail, '{}'::jsonb) ? 'evidence')`);
}

/**
 * Suspeita de abuso infantil: o conteúdo sai do ar e fica preservado (guarda legal desde já), e o caso só fecha depois
 * da denúncia às autoridades. Qualquer cargo que tira conteúdo do ar marca; `false` se o caso não está aberto ou já
 * estava marcado.
 */
export async function flagChildSafety(
  tx: Executor,
  input: {
    tenantId: string;
    caseId: string;
    actor: ModerationActor;
    holdUntil: Date;
    clocks: ModerationClocks;
    now: Date;
  },
): Promise<boolean> {
  const [c] = await tx
    .update(moderationCase)
    .set({
      childSafety: true,
      legalHoldUntil: sql`greatest(coalesce(${moderationCase.legalHoldUntil}, ${input.holdUntil.toISOString()}::timestamptz), ${input.holdUntil.toISOString()}::timestamptz)`,
      hiddenAt: sql`coalesce(${moderationCase.hiddenAt}, ${input.now.toISOString()}::timestamptz)`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(moderationCase.tenantId, input.tenantId),
        eq(moderationCase.id, input.caseId),
        eq(moderationCase.status, 'open'),
        eq(moderationCase.childSafety, false),
      ),
    )
    .returning({
      module: moderationCase.module,
      targetType: moderationCase.targetType,
      targetId: moderationCase.targetId,
      targetProfileId: moderationCase.targetProfileId,
    });
  if (!c) return false;
  await holdCaseContent(tx, input.tenantId, c, input.holdUntil, input.caseId);
  await audit(tx, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: 'authority.flag',
    clocks: input.clocks,
    subjectProfileId: c.targetProfileId,
    caseId: input.caseId,
    reason: 'child_safety',
    rules: { legalHoldUntil: input.holdUntil.toISOString() },
  });
  return true;
}

/**
 * Registra a denúncia às autoridades (só o admin do cliente e a equipe Galaxie; quem chama confere o cargo). A guarda
 * conta da denúncia, pelo `legalHoldDays` da ficha. `false` se o caso não existe ou já foi denunciado.
 */
export async function reportToAuthorities(
  tx: Executor,
  input: {
    tenantId: string;
    caseId: string;
    actor: ModerationActor;
    reference: string | null;
    holdUntil: Date;
    clocks: ModerationClocks;
    now: Date;
  },
): Promise<boolean> {
  const [c] = await tx
    .update(moderationCase)
    .set({
      authorityReportedAt: input.now,
      authorityReportedBy: input.actor.id,
      authorityReference: input.reference,
      legalHoldUntil: sql`greatest(coalesce(${moderationCase.legalHoldUntil}, ${input.holdUntil.toISOString()}::timestamptz), ${input.holdUntil.toISOString()}::timestamptz)`,
      hiddenAt: sql`coalesce(${moderationCase.hiddenAt}, ${input.now.toISOString()}::timestamptz)`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(moderationCase.tenantId, input.tenantId),
        eq(moderationCase.id, input.caseId),
        isNull(moderationCase.authorityReportedAt),
        // a apelação é sobre a punição; a denúncia vai no caso original
        sql`${moderationCase.source} <> 'appeal'`,
      ),
    )
    .returning({
      module: moderationCase.module,
      targetType: moderationCase.targetType,
      targetId: moderationCase.targetId,
      targetProfileId: moderationCase.targetProfileId,
      childSafety: moderationCase.childSafety,
    });
  if (!c) return false;
  await holdCaseContent(tx, input.tenantId, c, input.holdUntil, input.caseId);
  await audit(tx, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: 'authority.report',
    clocks: input.clocks,
    subjectProfileId: c.targetProfileId,
    caseId: input.caseId,
    reason: c.childSafety ? 'child_safety' : 'authority',
    rules: {
      legalHoldUntil: input.holdUntil.toISOString(),
      ...(input.reference ? { reference: input.reference } : {}),
    },
  });
  return true;
}
