/**
 * Auditoria amostral (issue #52, docs/07 §4): a cada dia, 20 opções publicadas são sorteadas para
 * conferência humana, mais todas as publicadas com confiança entre 0,70 e 0,75 (perto do limiar —
 * docs/research/onde-assistir.md §3.5). O veredito alimenta a métrica de precisão.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { broadcastAudit, broadcastOption, type Database } from '@galaxie/db';
import { assertActor, WtwError } from './editorial.js';

export const AUDIT_DAILY_SAMPLE = 20;
export const AUDIT_VERDICTS = ['correct', 'incorrect', 'unsure'] as const;
export type AuditVerdict = (typeof AUDIT_VERDICTS)[number];

export interface SampleOptions {
  /** Dia da amostra (AAAA-MM-DD, UTC). */
  date: string;
  size?: number;
  /** Faixa de confiança auditada integralmente. */
  lowConfidence?: [number, number];
}

export interface SampleResult {
  sampled: number;
  lowConfidence: number;
}

/**
 * Sorteia opções vigentes `confirmed` ainda não auditadas. O sorteio é determinístico por dia
 * (md5(id || dia)) — reexecutar no mesmo dia não muda a amostra (idempotente).
 */
export async function sampleForAudit(db: Database, options: SampleOptions): Promise<SampleResult> {
  const size = options.size ?? AUDIT_DAILY_SAMPLE;
  const [lo, hi] = options.lowConfidence ?? [0.7, 0.75];
  const notAudited = sql`not exists (select 1 from ${broadcastAudit} a where a.option_id = ${broadcastOption.id})`;
  const base = and(isNull(broadcastOption.supersededBy), eq(broadcastOption.status, 'confirmed'), notAudited);

  const low = await db
    .select({
      id: broadcastOption.id,
      eventId: broadcastOption.eventId,
      country: broadcastOption.countryCode,
    })
    .from(broadcastOption)
    .where(
      and(
        base,
        sql`${broadcastOption.confidence} >= ${lo}`,
        sql`${broadcastOption.confidence} <= ${hi}`,
        sql`${broadcastOption.producedBy} not like 'editorial:%'`,
      ),
    );
  const lowIds = new Set(low.map((r) => r.id));
  const random = await db
    .select({
      id: broadcastOption.id,
      eventId: broadcastOption.eventId,
      country: broadcastOption.countryCode,
    })
    .from(broadcastOption)
    .where(base)
    .orderBy(sql`md5(${broadcastOption.id}::text || ${options.date})`)
    .limit(size + lowIds.size);
  const picked = random.filter((r) => !lowIds.has(r.id)).slice(0, size);

  const rows = [
    ...low.map((r) => ({ ...r, reason: 'low_confidence' })),
    ...picked.map((r) => ({ ...r, reason: 'daily_sample' })),
  ];
  if (!rows.length) return { sampled: 0, lowConfidence: 0 };
  const inserted = await db
    .insert(broadcastAudit)
    .values(
      rows.map((r) => ({
        optionId: r.id,
        eventId: r.eventId,
        countryCode: r.country,
        sampleDate: options.date,
        reason: r.reason,
      })),
    )
    .onConflictDoNothing()
    .returning({ reason: broadcastAudit.reason });
  return {
    sampled: inserted.length,
    lowConfidence: inserted.filter((r) => r.reason === 'low_confidence').length,
  };
}

export interface PendingAudit {
  auditId: string;
  sampleDate: string;
  reason: string;
  optionId: string;
  eventId: string;
  country: string;
  provider: string;
  channel: string | null;
  medium: string;
  region: string | null;
  confidence: number;
  sources: string[];
}

/** Fila de auditoria ainda sem veredito (mais antigas primeiro). */
export async function listPendingAudits(db: Database, limit = 50): Promise<PendingAudit[]> {
  const rows = await db
    .select({ a: broadcastAudit, o: broadcastOption })
    .from(broadcastAudit)
    .innerJoin(broadcastOption, eq(broadcastOption.id, broadcastAudit.optionId))
    .where(isNull(broadcastAudit.verdict))
    .orderBy(asc(broadcastAudit.sampleDate), asc(broadcastAudit.createdAt))
    .limit(limit);
  return rows.map(({ a, o }) => ({
    auditId: a.id,
    sampleDate: a.sampleDate,
    reason: a.reason,
    optionId: o.id,
    eventId: o.eventId,
    country: o.countryCode,
    provider: o.providerName,
    channel: o.channelName,
    medium: o.medium,
    region: o.region,
    confidence: Number(o.confidence),
    sources: o.evidence.map((e) => e.url),
  }));
}

/** Registra o veredito humano de uma amostra. */
export async function recordVerdict(
  db: Database,
  auditId: string,
  input: { verdict: AuditVerdict; reviewer: string; note?: string | null; now?: Date },
): Promise<void> {
  assertActor(input.reviewer);
  if (!AUDIT_VERDICTS.includes(input.verdict))
    throw new WtwError('invalid', `Veredito inválido: ${input.verdict}`);
  const r = await db
    .update(broadcastAudit)
    .set({
      verdict: input.verdict,
      reviewer: input.reviewer,
      note: input.note ?? null,
      reviewedAt: input.now ?? new Date(),
    })
    .where(eq(broadcastAudit.id, auditId))
    .returning({ id: broadcastAudit.id });
  if (!r.length) throw new WtwError('not_found', 'Amostra de auditoria não encontrada.');
}
