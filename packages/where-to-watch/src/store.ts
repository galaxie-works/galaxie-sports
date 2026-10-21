/**
 * Persistência versionada do onde assistir (enrich.broadcast_option).
 *
 * Cada mudança material gera uma NOVA linha; a anterior recebe `superseded_by`/`superseded_at`.
 * A versão vigente de cada chave (região|emissora|meio) é a linha com `superseded_by` nulo
 * (remoções viram uma versão `retracted`, que funciona como lápide). Mudanças que alteram o que
 * a API pública mostra publicam `where_to_watch.changed` no change feed (purge de cache, SSE, webhook).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { broadcastOption, publishChange, type Database, type Evidence } from '@galaxie/db';
import { optionKey, type ValidatedOption } from './validator.js';

export type BroadcastOptionRow = typeof broadcastOption.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

/** Assinatura do agente nas versões que ele produz. */
export const AGENT_PRODUCER = 'agent:wtw@v1';
export const CHANGE_TOPIC = 'where_to_watch.changed';
export const CHANGE_ENTITY = 'where_to_watch';

export const isEditorial = (row: Pick<BroadcastOptionRow, 'producedBy'>) =>
  row.producedBy.startsWith('editorial:');

export function rowKey(
  row: Pick<BroadcastOptionRow, 'region' | 'broadcasterId' | 'providerName' | 'medium'>,
): string {
  return optionKey(row);
}

/** Versões vigentes (inclui lápides `retracted`) de um evento × país. */
export async function currentOptions(
  db: Executor,
  eventId: string,
  country: string,
): Promise<BroadcastOptionRow[]> {
  return db
    .select()
    .from(broadcastOption)
    .where(
      and(
        eq(broadcastOption.eventId, eventId),
        eq(broadcastOption.countryCode, country),
        isNull(broadcastOption.supersededBy),
      ),
    );
}

/** Campos que, se mudarem, geram uma nova versão. */
function material(o: {
  status: string;
  providerName: string;
  channelName: string | null;
  accessModel: string;
  url: string | null;
  conflict: boolean;
  confidence: string | number;
  flags: string[];
}): string {
  return JSON.stringify([
    o.status,
    o.providerName,
    o.channelName ?? null,
    o.accessModel,
    o.url ?? null,
    o.conflict,
    Number(o.confidence).toFixed(2),
    [...o.flags].sort(),
  ]);
}

/** Inserir uma nova versão e aposentar a anterior, na mesma transação. */
export async function insertVersion(
  tx: Executor,
  values: typeof broadcastOption.$inferInsert,
  previous: BroadcastOptionRow | null,
  now: Date,
): Promise<BroadcastOptionRow> {
  const [row] = await tx
    .insert(broadcastOption)
    .values({ ...values, firstSeenAt: previous?.firstSeenAt ?? values.firstSeenAt ?? now, createdAt: now })
    .returning();
  if (previous) {
    await tx
      .update(broadcastOption)
      .set({ supersededBy: row!.id, supersededAt: now })
      .where(eq(broadcastOption.id, previous.id));
  }
  return row!;
}

/** Algo visível na API pública mudou? (status confirmado antes ou depois). */
export function publicDiff(before: BroadcastOptionRow | null, after: BroadcastOptionRow | null): boolean {
  return before?.status === 'confirmed' || after?.status === 'confirmed';
}

export async function notifyChange(
  db: Database,
  eventId: string,
  country: string,
  payload: Record<string, unknown>,
): Promise<number> {
  return publishChange(db, {
    topic: CHANGE_TOPIC,
    entityType: CHANGE_ENTITY,
    entityId: eventId,
    payload: { country, ...payload },
  });
}

export interface ApplyAgentInput {
  eventId: string;
  country: string;
  options: ValidatedOption[];
  /** Execução completa: chaves vigentes do agente que sumiram viram `retracted`. */
  retractMissing: boolean;
  runId?: string | null;
  producedBy?: string;
  now: Date;
}

export interface ApplyResult {
  inserted: number;
  touched: number;
  retracted: number;
  /** Chaves travadas por correção editorial (o agente não sobrescreve). */
  lockedByEditorial: number;
  publicChanged: boolean;
  changeId: number | null;
  /** Ids das versões inseridas. */
  insertedIds: string[];
}

/** Grava o resultado validado de uma execução do agente (versionado, idempotente). */
export async function applyAgentResult(db: Database, input: ApplyAgentInput): Promise<ApplyResult> {
  const producedBy = input.producedBy ?? AGENT_PRODUCER;
  const result: ApplyResult = {
    inserted: 0,
    touched: 0,
    retracted: 0,
    lockedByEditorial: 0,
    publicChanged: false,
    changeId: null,
    insertedIds: [],
  };

  await db.transaction(async (tx) => {
    // Serializa execuções concorrentes do mesmo evento × país.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wtw:${input.eventId}:${input.country}`}))`);
    const current = await currentOptions(tx, input.eventId, input.country);
    const byKey = new Map(current.map((r) => [rowKey(r), r]));
    const seen = new Set<string>();

    for (const o of input.options) {
      seen.add(o.key);
      const prev = byKey.get(o.key) ?? null;
      if (prev && isEditorial(prev)) {
        result.lockedByEditorial++;
        continue;
      }
      const next = {
        status: o.status,
        providerName: o.providerName,
        channelName: o.channel,
        accessModel: o.accessModel,
        url: o.url,
        conflict: o.conflict,
        confidence: o.confidence.toFixed(2),
        flags: o.flags,
      };
      if (prev && material(prev) === material(next)) {
        await tx
          .update(broadcastOption)
          .set({ lastVerifiedAt: input.now, evidence: o.evidence, runId: input.runId ?? prev.runId })
          .where(eq(broadcastOption.id, prev.id));
        result.touched++;
        continue;
      }
      const row = await insertVersion(
        tx,
        {
          eventId: input.eventId,
          countryCode: input.country,
          region: o.region,
          providerName: o.providerName,
          broadcasterId: o.broadcasterId,
          channelName: o.channel,
          medium: o.medium,
          accessModel: o.accessModel,
          url: o.url,
          language: o.language,
          status: o.status,
          confidence: o.confidence.toFixed(2),
          evidence: o.evidence,
          sourceKind: o.sourceKind,
          conflict: o.conflict,
          flags: o.flags,
          lastVerifiedAt: input.now,
          producedBy,
          runId: input.runId ?? null,
        },
        prev,
        input.now,
      );
      result.inserted++;
      result.insertedIds.push(row.id);
      if (publicDiff(prev, row)) result.publicChanged = true;
    }

    if (input.retractMissing) {
      for (const prev of current) {
        if (seen.has(rowKey(prev)) || prev.status === 'retracted' || isEditorial(prev)) continue;
        const row = await insertVersion(
          tx,
          {
            ...stripVersionFields(prev),
            status: 'retracted',
            flags: [...new Set([...prev.flags, 'not_found_again'])].sort(),
            lastVerifiedAt: input.now,
            producedBy,
            runId: input.runId ?? null,
          },
          prev,
          input.now,
        );
        result.retracted++;
        result.insertedIds.push(row.id);
        if (publicDiff(prev, null)) result.publicChanged = true;
      }
    }
    // Publica na mesma transação da escrita: o trigger de captura (ops.capture_broadcast_change) e esta
    // publicação viram uma única linha no change feed (ops.publish_change funde por tópico × entidade).
    if (result.publicChanged) {
      result.changeId = await notifyChange(tx as unknown as Database, input.eventId, input.country, {
        reason: 'agent',
        runId: input.runId ?? null,
      });
    }
  });
  return result;
}

/** Copia os campos de conteúdo de uma versão (para criar a próxima). */
export function stripVersionFields(row: BroadcastOptionRow): typeof broadcastOption.$inferInsert {
  return {
    eventId: row.eventId,
    countryCode: row.countryCode,
    region: row.region,
    providerName: row.providerName,
    broadcasterId: row.broadcasterId,
    channelName: row.channelName,
    medium: row.medium,
    accessModel: row.accessModel,
    url: row.url,
    language: row.language,
    status: row.status,
    confidence: row.confidence,
    evidence: row.evidence,
    sourceKind: row.sourceKind,
    conflict: row.conflict,
    flags: row.flags,
    firstSeenAt: row.firstSeenAt,
    lastVerifiedAt: row.lastVerifiedAt,
    producedBy: row.producedBy,
    runId: row.runId,
  };
}

/** Revalidação sem mudança: renova `last_verified_at` (e o hash das evidências) sem criar versão. */
export async function touchVerified(
  db: Database,
  updates: { id: string; evidence: Evidence[] }[],
  now: Date,
): Promise<number> {
  let n = 0;
  for (const u of updates) {
    const r = await db
      .update(broadcastOption)
      .set({ lastVerifiedAt: now, evidence: u.evidence })
      .where(and(eq(broadcastOption.id, u.id), isNull(broadcastOption.supersededBy)))
      .returning({ id: broadcastOption.id });
    n += r.length;
  }
  return n;
}

/** Histórico completo (todas as versões) de um evento × país, da mais nova para a mais antiga. */
export async function optionHistory(
  db: Database,
  eventId: string,
  country: string,
): Promise<BroadcastOptionRow[]> {
  return db
    .select()
    .from(broadcastOption)
    .where(and(eq(broadcastOption.eventId, eventId), eq(broadcastOption.countryCode, country)))
    .orderBy(sql`${broadcastOption.createdAt} desc`, sql`${broadcastOption.id} desc`);
}

export async function optionsByIds(db: Database, ids: string[]): Promise<BroadcastOptionRow[]> {
  if (!ids.length) return [];
  return db.select().from(broadcastOption).where(inArray(broadcastOption.id, ids));
}
