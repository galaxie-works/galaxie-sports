/**
 * Cores dos times: extrai a paleta (predominante, secundária, monocromático) dos escudos já espelhados
 * no bucket e grava em core.asset.palette — base do `colors`/gradiente sugerido do Team na API.
 * Zero chamadas ao fornecedor: lê o objeto do storage e decodifica o PNG localmente.
 *
 *   pnpm --filter @galaxie/ingestor assets:palette --plan        # quantos escudos estão sem paleta
 *   pnpm --filter @galaxie/ingestor assets:palette               # calcula e grava
 *   opções: --limite N · --verbose (imprime cada paleta)
 *
 * Variáveis: DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
 */
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { closeDb, createDb, jobRun } from '@galaxie/db';
import { PgAssetStore } from '../assets/asset-store.js';
import { objectStoreFromEnv } from '../assets/object-store.js';
import { runPaletteBackfill } from '../assets/palette-backfill.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    limite: { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
});

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');

const db = createDb(DATABASE_URL);
const assets = new PgAssetStore(db);
const limit = values.limite ? Number(values.limite) : undefined;

try {
  if (values.plan) {
    const candidates = await assets.paletteCandidates(limit);
    console.log(
      `Escudos (team_logo PNG espelhados) sem paleta: ${candidates.length} (nenhuma chamada ao fornecedor).`,
    );
  } else {
    const objects = objectStoreFromEnv();
    const [run] = await db.insert(jobRun).values({ job: 'assets:palette', status: 'running' }).returning();
    try {
      let done = 0;
      const report = await runPaletteBackfill({
        assets,
        objects,
        limit,
        onProgress: (e) => {
          if (e.type === 'skipped') console.warn(`  ignorado ${e.storageKey}: ${e.reason}`);
          else if (values.verbose) console.log(`  ${e.storageKey} → ${JSON.stringify(e.palette)}`);
          if (++done % 500 === 0) console.log(`  ${done} processados...`);
        },
      });
      objects.close();
      await db
        .update(jobRun)
        .set({ status: 'ok', finishedAt: new Date(), stats: report })
        .where(eq(jobRun.id, run!.id));
      console.log(
        `Candidatos: ${report.candidates} · paletas gravadas: ${report.saved} (monocromáticas: ${report.monochrome}) · ignorados: ${report.skipped}`,
      );
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
