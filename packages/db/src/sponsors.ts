/**
 * Impressões dos patrocinadores (#1021, B10): os módulos que mostram a peça (sala do chat, campanha de bolão,
 * recompensa) somam aqui, por patrocinador, lugar e dia. Só contagem: nenhum torcedor, sessão ou IP é gravado.
 * O cadastro e as regras ficam em `@galaxie/engage` (`validateSponsor`, `sponsorVisible`).
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { sponsorImpressionDaily } from './schema/engage.js';

export type SponsorSurfaceKind = 'chat_room' | 'prediction_campaign' | 'reward';

export interface SponsorImpression {
  tenantId: string;
  sponsorId: string;
  surface: SponsorSurfaceKind;
  surfaceId: string;
  /** Dia em UTC (`YYYY-MM-DD`). */
  day: string;
  count: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Soma um lote de impressões (o módulo agrega em memória e grava de tempos em tempos). */
export async function recordSponsorImpressions(db: Database, rows: SponsorImpression[]): Promise<void> {
  const valid = rows.filter((r) => {
    if (!DAY.test(r.day) || !Number.isSafeInteger(r.count) || r.count <= 0)
      throw new Error(`impressão inválida: ${r.day} ${r.count}`);
    return true;
  });
  if (!valid.length) return;
  // o mesmo patrocinador, lugar e dia duas vezes no lote viram uma linha só (o upsert recusa linha repetida)
  const merged = new Map<string, SponsorImpression>();
  for (const r of valid) {
    const k = [r.tenantId, r.sponsorId, r.surface, r.surfaceId, r.day].join('\u0000');
    const prev = merged.get(k);
    merged.set(k, prev ? { ...prev, count: prev.count + r.count } : r);
  }
  await db
    .insert(sponsorImpressionDaily)
    .values(
      [...merged.values()].map((r) => ({
        tenantId: r.tenantId,
        sponsorId: r.sponsorId,
        surface: r.surface,
        surfaceId: r.surfaceId,
        day: r.day,
        impressions: r.count,
      })),
    )
    .onConflictDoUpdate({
      target: [
        sponsorImpressionDaily.tenantId,
        sponsorImpressionDaily.sponsorId,
        sponsorImpressionDaily.surface,
        sponsorImpressionDaily.surfaceId,
        sponsorImpressionDaily.day,
      ],
      set: { impressions: sql`${sponsorImpressionDaily.impressions} + excluded.impressions` },
    });
}

export interface SponsorReportRow {
  sponsorId: string;
  surface: SponsorSurfaceKind;
  surfaceId: string;
  impressions: number;
  days: number;
}

/** Relatório do período (dias em UTC, inclusive), por patrocinador e lugar. */
export async function sponsorImpressionReport(
  db: Database,
  tenantId: string,
  range: { from: string; to: string; sponsorId?: string },
): Promise<SponsorReportRow[]> {
  if (!DAY.test(range.from) || !DAY.test(range.to)) throw new Error('período inválido');
  const rows = await db
    .select({
      sponsorId: sponsorImpressionDaily.sponsorId,
      surface: sponsorImpressionDaily.surface,
      surfaceId: sponsorImpressionDaily.surfaceId,
      impressions: sql<string>`sum(${sponsorImpressionDaily.impressions})`,
      days: sql<string>`count(distinct ${sponsorImpressionDaily.day})`,
    })
    .from(sponsorImpressionDaily)
    .where(
      and(
        eq(sponsorImpressionDaily.tenantId, tenantId),
        gte(sponsorImpressionDaily.day, range.from),
        lte(sponsorImpressionDaily.day, range.to),
        ...(range.sponsorId ? [eq(sponsorImpressionDaily.sponsorId, range.sponsorId)] : []),
      ),
    )
    .groupBy(
      sponsorImpressionDaily.sponsorId,
      sponsorImpressionDaily.surface,
      sponsorImpressionDaily.surfaceId,
    )
    .orderBy(sql`sum(${sponsorImpressionDaily.impressions}) desc`);
  return rows.map((r) => ({
    sponsorId: r.sponsorId,
    surface: r.surface as SponsorSurfaceKind,
    surfaceId: r.surfaceId,
    impressions: Number(r.impressions),
    days: Number(r.days),
  }));
}
