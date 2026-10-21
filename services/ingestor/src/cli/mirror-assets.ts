/**
 * Asset Mirror (issue #18): baixa logos, bandeiras, fotos etc. da CDN de mídia da api-sports para o bucket S3.
 * Não consome cota da API de dados; a CDN tem limite por segundo/minuto, então o paralelismo é baixo.
 *
 *   pnpm --filter @galaxie/ingestor assets:mirror --plan              # quantos faltam, sem baixar
 *   pnpm --filter @galaxie/ingestor assets:mirror                     # baixa o que falta em core.asset
 *   pnpm --filter @galaxie/ingestor assets:mirror --descobrir-raw     # antes, registra toda URL de mídia do raw
 *   opções: --limite N · --concorrencia N (padrão 3) · --pausa-ms N (padrão 250) · --retentar-ausentes
 *
 * Variáveis: DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, ASSETS_PUBLIC_BASE_URL.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { publicAssetUrl } from '@galaxie/apisports-client';
import { closeDb, createDb, jobRun } from '@galaxie/db';
import { loadMediaDenylist, runAssetMirror } from '../assets/asset-mirror.js';
import { PgAssetStore } from '../assets/asset-store.js';
import { objectStoreFromEnv } from '../assets/object-store.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    'descobrir-raw': { type: 'boolean', default: false },
    'retentar-ausentes': { type: 'boolean', default: false },
    limite: { type: 'string' },
    concorrencia: { type: 'string', default: '3' },
    'pausa-ms': { type: 'string', default: '250' },
    denylist: { type: 'string', default: resolve('../../config/assets/denylist.yaml') },
  },
});

const { DATABASE_URL, ASSETS_PUBLIC_BASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');

const db = createDb(DATABASE_URL);
const assets = new PgAssetStore(db);
const denylist = await loadMediaDenylist(values.denylist);

try {
  if (values['descobrir-raw']) {
    const urls = await assets.discoverFromRaw();
    const added = await assets.register(urls.filter((u) => !denylist.has(u)));
    console.log(`URLs de mídia no raw: ${urls.length} · novas em core.asset: ${added}`);
  }

  const before = await assets.counts();
  console.log(
    `core.asset: ${before.total} · espelhados: ${before.stored} · ausentes (404/bloqueados): ${before.missing} · pendentes: ${before.pending}`,
  );

  if (values.plan) {
    const report = await runAssetMirror({
      assets,
      objects: {
        put: async () => {},
        head: async () => undefined,
        get: async () => undefined,
        delete: async () => {},
      },
      denylist,
      dryRun: true,
      includeMissing: values['retentar-ausentes'],
      limit: values.limite ? Number(values.limite) : undefined,
    });
    console.log(`A baixar nesta execução: ${report.pending} (nenhuma chamada à API de dados).`);
  } else {
    const objects = objectStoreFromEnv();
    const [run] = await db.insert(jobRun).values({ job: 'assets:mirror', status: 'running' }).returning();
    try {
      let done = 0;
      const report = await runAssetMirror({
        assets,
        objects,
        denylist,
        concurrency: Number(values.concorrencia),
        delayMs: Number(values['pausa-ms']),
        includeMissing: values['retentar-ausentes'],
        limit: values.limite ? Number(values.limite) : undefined,
        onProgress: (e) => {
          if (e.type === 'aborted') console.warn(e.reason);
          else if (++done % 100 === 0) console.log(`  ${done} processados...`);
          if (e.type === 'failed') console.warn(`  falha ${e.asset.sourceUrl}: ${e.reason}`);
        },
      });
      objects.close();
      const stats = {
        ...report,
        failures: report.failures.slice(0, 50),
        notFoundUrls: report.notFoundUrls.slice(0, 50),
      };
      await db
        .update(jobRun)
        .set({
          status: report.aborted ? 'error' : 'ok',
          finishedAt: new Date(),
          stats,
          error: report.aborted,
        })
        .where(eq(jobRun.id, run!.id));
      console.log(
        `Espelhados: ${report.stored} (${(report.bytes / 1024).toFixed(0)} KiB) · 404: ${report.notFound} · bloqueados: ${report.denied} · desvinculados: ${report.unlinked} · falhas: ${report.failed}`,
      );
      if (ASSETS_PUBLIC_BASE_URL) {
        console.log(`URLs públicas: ${publicAssetUrl('<storage_key>', ASSETS_PUBLIC_BASE_URL)}`);
      }
      if (report.aborted) process.exitCode = 1;
    } catch (err) {
      await db
        .update(jobRun)
        .set({ status: 'error', finishedAt: new Date(), error: String(err) })
        .where(eq(jobRun.id, run!.id));
      throw err;
    }
  }
} finally {
  await closeDb(db);
}
