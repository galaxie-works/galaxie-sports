/**
 * Acervo de fotos da F1 a partir da Wikimedia Commons (licenças livres) — docs/runbooks/fotos-commons.md.
 *   pnpm --filter @galaxie/ingestor assets:commons --mapear [--escopo senna|campeoes|mais-corridas] [--limite 30]
 *       busca na Commons, aplica as regras (licença, tipo, resolução, época) e grava o manifesto
 *       config/assets/commons/f1.yaml e o relatório f1.cobertura.md (não grava no banco). Só regras: a ordem do
 *       Gemini é um passo à parte (assets-commons-ordenar), e os alvos já ordenados ficam como estão (--refazer)
 *   pnpm --filter @galaxie/ingestor assets:commons --plan     # prévia da importação
 *   pnpm --filter @galaxie/ingestor assets:commons            # importa (idempotente)
 * Opções: --so driver/ayrton-senna,car/mclaren/1988, --manifesto <arquivo>, --refazer.
 * O F1DB precisa estar no raw (f1db:import) com as tabelas de equipes e chassis.
 */
import { join } from 'node:path';
import { closeDb, createDb } from '@galaxie/db';
import { WikimediaClient } from '../assets/commons/client.js';
import { importCommons } from '../assets/commons/import.js';
import { loadF1dbForCommons } from '../assets/commons/load.js';
import { readManifest, writeManifest } from '../assets/commons/manifest.js';
import { coverageReport, mapCommons, writeReport } from '../assets/commons/map.js';
import { COMMONS_SCOPES, targetKey, targetsFor, type CommonsScope } from '../assets/commons/scope.js';
import { objectStoreFromEnv } from '../assets/object-store.js';
import { listArg, parseArgs } from '../multisport/cli-args.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const args = parseArgs(process.argv.slice(2));
const root = join(import.meta.dirname, '..', '..', '..', '..');
const manifestPath = String(args.get('manifesto') ?? join(root, 'config', 'assets', 'commons', 'f1.yaml'));
const only = listArg(args, 'so');
const log = (m: string) => console.log(m);

/** Na prévia nada é gravado no storage. */
const nullStore = {
  put: async () => {},
  head: async () => undefined,
  get: async () => undefined,
  delete: async () => {},
};

const db = createDb(url, { max: 3 });
const client = new WikimediaClient({ log });
try {
  if (args.has('mapear')) {
    const scope = String(args.get('escopo') ?? 'senna') as CommonsScope;
    if (!COMMONS_SCOPES.includes(scope)) throw new Error(`--escopo: use ${COMMONS_SCOPES.join(', ')}`);
    const { tables, release } = await loadF1dbForCommons(db);
    let targets = targetsFor(tables, scope, Number(args.get('limite') ?? 30));
    if (only) targets = targets.filter((t) => only.includes(targetKey(t)));
    console.log(`escopo ${scope}: ${targets.length} alvos; F1DB ${release ?? '?'}; só regras`);
    const { manifest, stats } = await mapCommons(client, targets, readManifest(manifestPath), {
      revision: new Date().toISOString().slice(0, 10),
      redo: args.has('refazer'),
      log,
    });
    writeManifest(manifestPath, manifest);
    writeReport(manifestPath.replace(/\.yaml$/, '.cobertura.md'), coverageReport(manifest, stats));
    console.table(
      stats.map((s) => ({
        alvo: s.key,
        candidatas: s.candidates,
        aceitas: s.eligible,
        escolhidas: s.chosen,
        ordem: s.ranking,
      })),
    );
    console.log(`manifesto: ${manifestPath} · ${client.requests} requisições à Wikimedia`);
  } else {
    const manifest = readManifest(manifestPath);
    if (!manifest) throw new Error(`Manifesto não encontrado: ${manifestPath} (rode --mapear).`);
    const plan = args.has('plan');
    const report = await importCommons(db, plan ? nullStore : objectStoreFromEnv(), client, manifest, {
      plan,
      ...(only ? { only: new Set(only) } : {}),
      log,
    });
    console.table({
      alvos: report.entries,
      fotos: report.photos,
      [plan ? 'a baixar' : 'baixadas']: report.stored,
      'já no storage': report.unchanged,
      vinculadas: report.linked,
      desvinculadas: report.unlinked,
      'carro de destaque (pilotos)': report.highlights,
    });
    if (report.skipped.length)
      console.log(
        `\nIgnoradas:\n  ${report.skipped.map((s) => `${s.key}${s.file ? ` · ${s.file}` : ''}: ${s.reason}`).join('\n  ')}`,
      );
    console.log(`${client.requests} requisições à Wikimedia${plan ? ' · PRÉVIA (nada gravado)' : ''}`);
  }
} finally {
  await closeDb(db);
}
