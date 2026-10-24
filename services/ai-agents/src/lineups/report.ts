/**
 * Resumo da grade gravada por plataforma (sem LLM): quantos planos têm preço provado e como estão os
 * vínculos (incluso, adicional, sem prova, sem checagem do validador). Para comparar a grade antes e
 * depois de pesquisar de novo (`lineups:research --resumo`).
 */
import { and, inArray, ne } from 'drizzle-orm';
import { planChannel, planService, platform, platformAddon, platformPlan, type Database } from '@galaxie/db';

export interface LineupReportRow {
  country: string;
  slug: string;
  plans: number;
  /** Planos com preço cheio provado (`price_amount`). */
  priced: number;
  /** Planos que passaram no validador. */
  verifiedPlans: number;
  /** Planos com a grade confirmada pela página oficial. */
  pageConfirmed: number;
  /** Planos com preços divergentes entre as fontes. */
  priceConflicts: number;
  /** Planos listados na etapa 1 sem detalhe na etapa 2. */
  missingDetails: number;
  /** Ofertas do catálogo de complementos. */
  addons: number;
  channels: { included: number; addon: number; unverified: number };
  services: { included: number; addon: number; unverified: number };
  /** Vínculos gravados antes do validador (sem `verification`). */
  unchecked: number;
  /** Fontes oficiais entre as checadas (planos e vínculos). */
  official: number;
  checked: number;
}

export async function lineupReport(db: Database, countries: readonly string[]): Promise<LineupReportRow[]> {
  const platforms = await db
    .select({ id: platform.id, slug: platform.slug, country: platform.country })
    .from(platform)
    .where(and(inArray(platform.country, [...countries]), ne(platform.reviewStatus, 'rejected')));
  if (!platforms.length) return [];
  const plans = await db
    .select({
      id: platformPlan.id,
      platformId: platformPlan.platformId,
      priceAmount: platformPlan.priceAmount,
      verification: platformPlan.verification,
    })
    .from(platformPlan)
    .where(
      and(
        inArray(
          platformPlan.platformId,
          platforms.map((p) => p.id),
        ),
        ne(platformPlan.reviewStatus, 'rejected'),
      ),
    );
  const planIds = plans.map((p) => p.id);
  const [channels, services] = planIds.length
    ? await Promise.all([
        db
          .select({
            planId: planChannel.planId,
            access: planChannel.access,
            verification: planChannel.verification,
          })
          .from(planChannel)
          .where(and(inArray(planChannel.planId, planIds), ne(planChannel.reviewStatus, 'rejected'))),
        db
          .select({
            planId: planService.planId,
            access: planService.access,
            verification: planService.verification,
          })
          .from(planService)
          .where(and(inArray(planService.planId, planIds), ne(planService.reviewStatus, 'rejected'))),
      ])
    : [[], []];
  const planOf = new Map(plans.map((p) => [p.id, p.platformId]));
  const rows = new Map<string, LineupReportRow>(
    platforms.map((p) => [
      p.id,
      {
        country: p.country,
        slug: p.slug,
        plans: 0,
        priced: 0,
        verifiedPlans: 0,
        pageConfirmed: 0,
        priceConflicts: 0,
        missingDetails: 0,
        addons: 0,
        channels: { included: 0, addon: 0, unverified: 0 },
        services: { included: 0, addon: 0, unverified: 0 },
        unchecked: 0,
        official: 0,
        checked: 0,
      },
    ]),
  );
  const tier = (row: LineupReportRow, v: { tier: string | null } | null) => {
    if (!v) return;
    row.checked++;
    if (v.tier === 'official') row.official++;
  };
  for (const p of plans) {
    const row = rows.get(p.platformId)!;
    row.plans++;
    if (p.priceAmount !== null) row.priced++;
    if (p.verification?.verified) row.verifiedPlans++;
    if (p.verification?.checks.page === 'pass') row.pageConfirmed++;
    if (p.verification?.price_conflict) row.priceConflicts++;
    if (p.verification?.checks.details === 'fail') row.missingDetails++;
    tier(row, p.verification);
  }
  for (const [list, key] of [
    [channels, 'channels'],
    [services, 'services'],
  ] as const)
    for (const l of list) {
      const row = rows.get(planOf.get(l.planId)!)!;
      row[key][l.access]++;
      if (!l.verification) row.unchecked++;
      tier(row, l.verification);
    }
  const addons = await db
    .select({ platformId: platformAddon.platformId })
    .from(platformAddon)
    .where(
      and(
        inArray(
          platformAddon.platformId,
          platforms.map((p) => p.id),
        ),
        ne(platformAddon.reviewStatus, 'rejected'),
      ),
    );
  for (const a of addons) rows.get(a.platformId)!.addons++;
  return [...rows.values()].sort(
    (a, b) => a.country.localeCompare(b.country) || a.slug.localeCompare(b.slug),
  );
}
