/**
 * Backfill da atribuição pedida pelo autor (`Attribution` da Commons) nos créditos já gravados
 * (`core.asset_credit`). A importação passou a gravar o campo; os assets anteriores ficaram com `attribution`
 * nulo. Relê só o `extmetadata` (`Attribution`) dos arquivos sem atribuição, em lotes de 50, pelo cliente da
 * Wikimedia (User-Agent, intervalo entre requisições, `maxlag`). Idempotente: só preenche o que está nulo; o arquivo
 * que não pede atribuição continua nulo e é relido na próxima rodada (uma requisição a cada 50 arquivos).
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { assetCredit, type Database } from '@galaxie/db';
import type { WikimediaClient } from './client.js';
import { readAttribution } from './license.js';

export interface AttributionReport {
  /** Arquivos sem atribuição gravada, conferidos na Commons. */
  checked: number;
  /** Com atribuição na Commons: gravada (ou a gravar, na prévia). */
  updated: number;
  /** Sem atribuição na Commons: continuam nulos. */
  without: number;
  /** Não voltaram da Commons (arquivo apagado ou renomeado). */
  missing: string[];
}

const COMMONS = eq(assetCredit.source, 'wikimedia-commons');

export async function backfillAttribution(opts: {
  db: Database;
  client: Pick<WikimediaClient, 'extMetadata'>;
  /** Prévia: consulta a Commons e não grava. */
  plan?: boolean;
  /** Teto de arquivos na rodada. */
  limit?: number;
  log?: (msg: string) => void;
}): Promise<AttributionReport> {
  const { db } = opts;
  const rows = await db
    .selectDistinct({ title: assetCredit.title })
    .from(assetCredit)
    .where(and(COMMONS, isNull(assetCredit.attribution)))
    .orderBy(asc(assetCredit.title))
    .limit(opts.limit ?? 100_000);
  const titles = rows.map((r) => r.title);
  const report: AttributionReport = { checked: titles.length, updated: 0, without: 0, missing: [] };
  if (!titles.length) return report;
  const metas = await opts.client.extMetadata(titles, ['Attribution']);
  for (const title of titles) {
    const meta = metas.get(title);
    if (!meta) {
      report.missing.push(title);
      continue;
    }
    const attribution = readAttribution(meta);
    if (!attribution) {
      report.without += 1;
      continue;
    }
    report.updated += 1;
    opts.log?.(`${title}: ${attribution}`);
    if (opts.plan) continue;
    await db
      .update(assetCredit)
      .set({ attribution, retrievedAt: new Date() })
      .where(and(COMMONS, eq(assetCredit.title, title), isNull(assetCredit.attribution)));
  }
  return report;
}
