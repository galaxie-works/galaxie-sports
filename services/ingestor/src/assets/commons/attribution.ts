/**
 * Backfill da atribuição pedida pelo autor (`Attribution` da Commons) nos créditos já gravados
 * (`core.asset_credit`). A importação passou a gravar o campo; os assets anteriores ficaram com `attribution`
 * nulo. Relê só o `extmetadata` (`Attribution`) dos arquivos sem atribuição e ainda não conferidos, em lotes de 50,
 * pelo cliente da Wikimedia (User-Agent, intervalo entre requisições, `maxlag`).
 *
 * Todo crédito consultado ganha `attribution_checked_at`, com ou sem atribuição e também o do arquivo que sumiu da
 * Commons: uma rodada com `limit` não seleciona de novo os mesmos arquivos, e o resto da fila anda. Cada lote é
 * gravado ao voltar da Commons, então uma rodada interrompida não perde o que já conferiu. Idempotente: nunca
 * sobrescreve atribuição gravada; `recheck` ignora a marca (confere de novo os que continuam sem atribuição).
 *
 * Ao fim, as competições e plataformas cujo logo ganhou atribuição vão para o change feed (`competition:<id>`,
 * `platform:<id>`): a API purga as respostas com o `logo_credit` (TTL de até 24 h) e a demo revalida.
 */
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { assetCredit, competition, platform, publishChange, type Database } from '@galaxie/db';
import type { WikimediaClient } from './client.js';
import { readAttribution } from './license.js';

export interface AttributionReport {
  /** Arquivos sem atribuição gravada, conferidos na Commons. */
  checked: number;
  /** Com atribuição na Commons: gravada (ou a gravar, na prévia). */
  updated: number;
  /** Sem atribuição na Commons: continuam nulos, marcados como conferidos. */
  without: number;
  /** Não voltaram da Commons (arquivo apagado ou renomeado): marcados como conferidos. */
  missing: string[];
  /** Mudanças publicadas no change feed (competições e plataformas com o logo atualizado). */
  published: number;
}

const COMMONS = eq(assetCredit.source, 'wikimedia-commons');
/** Títulos por consulta à Commons (o teto da API para `titles`). */
const BATCH = 50;

export async function backfillAttribution(opts: {
  db: Database;
  client: Pick<WikimediaClient, 'extMetadata'>;
  /** Prévia: consulta a Commons e não grava (nem a marca). */
  plan?: boolean;
  /** Teto de arquivos na rodada. */
  limit?: number;
  /** Confere de novo os já conferidos que continuam sem atribuição. */
  recheck?: boolean;
  log?: (msg: string) => void;
}): Promise<AttributionReport> {
  const { db } = opts;
  const rows = await db
    .selectDistinct({ title: assetCredit.title })
    .from(assetCredit)
    .where(
      and(
        COMMONS,
        isNull(assetCredit.attribution),
        opts.recheck ? undefined : isNull(assetCredit.attributionCheckedAt),
      ),
    )
    .orderBy(asc(assetCredit.title))
    .limit(opts.limit ?? 100_000);
  const titles = rows.map((r) => r.title);
  const report: AttributionReport = {
    checked: titles.length,
    updated: 0,
    without: 0,
    missing: [],
    published: 0,
  };
  const updatedAssets: string[] = [];
  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    const metas = await opts.client.extMetadata(batch, ['Attribution']);
    const now = new Date();
    const unattributed: string[] = [];
    for (const title of batch) {
      const meta = metas.get(title);
      const attribution = meta ? readAttribution(meta) : null;
      if (!meta) report.missing.push(title);
      else if (!attribution) report.without += 1;
      if (!attribution) {
        unattributed.push(title);
        continue;
      }
      report.updated += 1;
      opts.log?.(`${title}: ${attribution}`);
      if (opts.plan) continue;
      const rows = await db
        .update(assetCredit)
        .set({ attribution, attributionCheckedAt: now, retrievedAt: now })
        .where(and(COMMONS, eq(assetCredit.title, title), isNull(assetCredit.attribution)))
        .returning({ assetId: assetCredit.assetId });
      updatedAssets.push(...rows.map((r) => r.assetId));
    }
    // sem atribuição ou fora da Commons: só a marca de conferido
    if (!opts.plan && unattributed.length)
      await db
        .update(assetCredit)
        .set({ attributionCheckedAt: now })
        .where(and(COMMONS, inArray(assetCredit.title, unattributed), isNull(assetCredit.attribution)));
  }
  if (updatedAssets.length) report.published = await publishLogoChanges(db, updatedAssets);
  return report;
}

/**
 * Competições e plataformas que usam um dos logos atualizados: uma mudança no change feed para cada. As fotos
 * (pessoas e F1) não expõem a atribuição, então não precisam de purge.
 */
async function publishLogoChanges(db: Database, assetIds: string[]): Promise<number> {
  const comps = await db
    .select({ id: competition.id })
    .from(competition)
    .where(or(inArray(competition.logoAssetId, assetIds), inArray(competition.customLogoAssetId, assetIds)));
  const platforms = await db
    .select({ id: platform.id })
    .from(platform)
    .where(inArray(platform.logoAssetId, assetIds));
  const changes = [
    ...comps.map((c) => ({ entityType: 'competition', entityId: c.id })),
    ...platforms.map((p) => ({ entityType: 'platform', entityId: p.id })),
  ];
  for (const c of changes)
    await publishChange(db, { topic: 'catalog', ...c, payload: { reason: 'commons_attribution' } });
  return changes.length;
}
