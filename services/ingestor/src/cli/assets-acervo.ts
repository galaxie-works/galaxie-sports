/**
 * Acervo customizado de logos: mapeia os logos de um pacote licenciado para os nossos times e
 * competições do futebol, espelha no storage e liga como `custom_logo_asset_id`. A API só serve esses
 * logos com a flag ASSETS_CUSTOM_LOGOS ligada (painel Ajustes → Operação). Zero chamadas ao fornecedor.
 *
 *   pnpm --filter @galaxie/ingestor assets:acervo --pasta <dir> --mapear   # manifesto + relatório
 *   pnpm --filter @galaxie/ingestor assets:acervo --pasta <dir> --plan     # prévia da importação
 *   pnpm --filter @galaxie/ingestor assets:acervo --pasta <dir>            # importa (idempotente)
 *   pnpm --filter @galaxie/ingestor assets:acervo --acervo <id> --desvincular [--plan]
 *
 * O manifesto fica em config/assets/acervo/<id>.yaml (versionado; curadoria à mão) e o relatório em
 * config/assets/acervo/<id>.cobertura.md. A pasta do pacote nunca entra no git. Ver
 * docs/runbooks/acervo-de-logos.md.
 *
 * Variáveis: DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { closeDb, createDb, jobRun } from '@galaxie/db';
import { detachAcervo, importAcervo, loadCountries, loadTargets } from '../assets/acervo/import.js';
import { ACERVO_ID_RE, readManifest, writeManifest } from '../assets/acervo/manifest.js';
import { planManifest } from '../assets/acervo/plan.js';
import { coverage, renderReport } from '../assets/acervo/report.js';
import { scanAcervo } from '../assets/acervo/scan.js';
import { objectStoreFromEnv } from '../assets/object-store.js';

const { values } = parseArgs({
  options: {
    pasta: { type: 'string' },
    acervo: { type: 'string' },
    manifesto: { type: 'string' },
    mapear: { type: 'boolean', default: false },
    plan: { type: 'boolean', default: false },
    desvincular: { type: 'boolean', default: false },
    lote: { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
});

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');

const MANIFEST_DIR = resolve('../../config/assets/acervo');
const dir = values.pasta ? resolve(values.pasta) : undefined;
const scan = dir ? scanAcervo(dir) : undefined;
const id = scan?.info.id ?? values.acervo;
if (!id || !ACERVO_ID_RE.test(id)) throw new Error('Informe --pasta <dir do pacote> ou --acervo <id>.');
if (values.acervo && scan && values.acervo !== scan.info.id)
  throw new Error(`--acervo ${values.acervo} difere do acervo.yaml do pacote (${scan.info.id}).`);
const manifestPath = values.manifesto ? resolve(values.manifesto) : join(MANIFEST_DIR, `${id}.yaml`);
const reportPath = manifestPath.replace(/\.ya?ml$/, '') + '.cobertura.md';

const db = createDb(DATABASE_URL);
try {
  if (values.desvincular) {
    const n = await detachAcervo(db, id, values.plan);
    console.log(
      values.plan
        ? `Prévia: ${n} times/competições perderiam o logo do acervo ${id}.`
        : `Acervo ${id}: ${n} times/competições voltaram ao logo do fornecedor (assets mantidos).`,
    );
  } else if (values.mapear) {
    if (!scan) throw new Error('--mapear precisa de --pasta.');
    const previous = existsSync(manifestPath) ? readManifest(manifestPath) : undefined;
    const [targets, countries] = await Promise.all([loadTargets(db), loadCountries(db)]);
    const { manifest, unknownCountries } = planManifest(scan, targets, countries, previous, new Date());
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeManifest(manifestPath, manifest);
    writeFileSync(reportPath, renderReport(manifest, unknownCountries), 'utf8');
    if (scan.ignored.length) console.warn(`Ignorados (fora do layout): ${scan.ignored.length}`);
    console.log(`Manifesto: ${manifestPath}\nRelatório: ${reportPath}`);
    for (const c of coverage(manifest.logos).slice(0, 20))
      console.log(
        `  ${c.country.padEnd(7)} ${String(c.total).padStart(5)} logos · ${c.linked} ligados · ${c.ambiguous} ambíguos · ${c.unmatched} sem par`,
      );
  } else {
    if (!dir) throw new Error('A importação precisa de --pasta (os arquivos do pacote).');
    if (!existsSync(manifestPath))
      throw new Error(`Sem manifesto em ${manifestPath}: rode antes com --mapear.`);
    const manifest = readManifest(manifestPath);
    const objects = objectStoreFromEnv();
    const [run] = values.plan
      ? [undefined]
      : await db.insert(jobRun).values({ job: 'assets:acervo', status: 'running' }).returning();
    try {
      const report = await importAcervo({
        db,
        objects,
        manifest,
        dir,
        dryRun: values.plan,
        ...(values.lote ? { batchSize: Number(values.lote) } : {}),
        onProgress: (e) => {
          if (e.type === 'skipped') console.warn(`  ignorado ${e.key}: ${e.reason}`);
          else if (values.verbose) console.log(`  ${e.key} → ${e.targetId}${e.uploaded ? ' (gravado)' : ''}`);
        },
      });
      objects.close();
      if (run)
        await db
          .update(jobRun)
          .set({ status: 'ok', finishedAt: new Date(), stats: { acervo: id, ...report } })
          .where(eq(jobRun.id, run.id));
      console.log(
        `${values.plan ? 'Prévia — ' : ''}acervo ${id}: ${report.linked} ligados · ${report.uploaded} gravados no storage · ${report.changed} vínculos novos · ${report.detached} desligados · ${report.skipped} ignorados`,
      );
    } catch (err) {
      if (run)
        await db
          .update(jobRun)
          .set({ status: 'error', finishedAt: new Date(), error: String(err) })
          .where(eq(jobRun.id, run.id));
      throw err;
    }
  }
} finally {
  await closeDb(db);
}
