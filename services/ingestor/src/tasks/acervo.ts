/**
 * `acervo.importar`: o `assets:acervo` como tarefa da fila. O pacote vem do S3 (`params.pacote`, em `tasks/<id>/`),
 * baixado para um diretório temporário da tomada; o manifesto é o versionado em config/assets/acervo/<acervo>.yaml ou
 * `params.manifesto` no S3.
 *
 * - Prévia (`previa`): o plano, como o `--plan` de hoje (ligados, desligados, ignorados, lotes), sem gravar nada no
 *   banco nem no storage dos logos; o relatório de cobertura vai para `tasks/<id da prévia>/cobertura.md` no S3 e o
 *   resumo dele para `checkpoint.previa`.
 * - Execução (só com `previaId`, da aprovação): lotes por país, até `lote` escudos cada; cada lote grava no storage,
 *   regrava o asset e liga ao time ou à competição, e o checkpoint é o último lote. Depois do último, o passo de
 *   desligar os que saíram do manifesto. Idempotente: retomar refaz no máximo o lote em andamento, sem regravar nada.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { eq } from 'drizzle-orm';
import { jobRequest, type Database } from '@galaxie/db';
import { appendLog } from '@galaxie/db/queue-types';
import {
  acervoLots,
  detachRemoved,
  emptyImportReport,
  existingTargets,
  importLot,
  wantedLogos,
} from '../assets/acervo/import.js';
import { readManifest, validateAcervoInfo, type AcervoManifest } from '../assets/acervo/manifest.js';
import {
  formatS3Uri,
  openPackage,
  parseS3Uri,
  S3PackageStore,
  tempDir,
  type PackageStore,
  type S3Uri,
} from '../assets/acervo/pacote.js';
import { coverage, renderReport } from '../assets/acervo/report.js';
import { objectStoreFromEnv, type ObjectStore } from '../assets/object-store.js';
import { runLots } from './lotes.js';
import { TaskRefusedError } from './errors.js';
import type { TaskHandler } from './run.js';

export interface AcervoTaskDeps {
  /** S3 do pacote, do manifesto e do relatório. */
  packages: () => PackageStore;
  /** Storage dos logos (o mesmo do `assets:acervo`). */
  objects: () => ObjectStore & { close?: () => void };
  /** Onde ficam os manifestos versionados. */
  manifestDir: string;
  /** Bucket do relatório da prévia (`tasks/<id>/cobertura.md`). */
  bucket: () => string;
}

export function acervoEnvDeps(env: NodeJS.ProcessEnv = process.env): AcervoTaskDeps {
  let packages: S3PackageStore | undefined;
  return {
    packages: () => (packages ??= S3PackageStore.fromEnv(env)),
    objects: () => objectStoreFromEnv(env),
    manifestDir: resolve('../../config/assets/acervo'),
    bucket: () => {
      if (!env.S3_BUCKET) throw new Error('Defina S3_BUCKET (.env).');
      return env.S3_BUCKET;
    },
  };
}

/** Chave do relatório de cobertura da prévia no S3. */
export const coverageKey = (taskId: string) => `tasks/${taskId}/cobertura.md`;

/** Tamanho máximo do relatório copiado no checkpoint (o inteiro fica no S3). */
const REPORT_IN_CHECKPOINT = 20_000;

interface AcervoParams {
  pacote: string;
  acervo: string;
  manifesto?: string;
  lote: number;
}

export function acervoImportar(deps?: AcervoTaskDeps): TaskHandler {
  return async (ctx) => {
    const d = deps ?? acervoEnvDeps();
    const params = ctx.params as unknown as AcervoParams;
    const pkg = await openPackage(params.pacote, d.packages);
    const manifestTmp = params.manifesto ? tempDir('galaxie-manifesto-') : undefined;
    try {
      const yaml = parse(readFileSync(join(pkg.dir, 'acervo.yaml'), 'utf8')) as {
        acervo?: Parameters<typeof validateAcervoInfo>[0];
      } | null;
      const info = validateAcervoInfo(yaml?.acervo);
      if (info.id !== params.acervo)
        throw new Error(`o pacote é do acervo ${info.id}, não de ${params.acervo}`);
      const { manifest, sha256: manifestoSha256 } = await loadManifest(d, params, manifestTmp?.dir);
      if (!pkg.sha256) throw new TaskRefusedError('o pacote da tarefa precisa ser um .tgz (s3://…)');
      const proof: Proof = { pacoteSha256: pkg.sha256, manifestoSha256 };
      const wanted = wantedLogos(manifest);
      const existing = await existingTargets(ctx.db, wanted);
      const lots = acervoLots(wanted, params.lote);

      if (ctx.previa) {
        const report = emptyImportReport();
        await importLot(
          { db: ctx.db, objects: NO_OBJECTS, manifest, dir: pkg.dir, dryRun: true },
          wanted,
          existing,
          report,
          new Set(),
        );
        report.detached = await detachRemoved(ctx.db, info.id, wanted, new Set(), true);
        const markdown = renderReport(manifest);
        const uri: S3Uri = { bucket: d.bucket(), key: coverageKey(ctx.task.id) };
        await d.packages().upload(uri, Buffer.from(markdown, 'utf8'), 'text/markdown; charset=utf-8');
        await ctx.save({
          previa: {
            resumo:
              `Acervo ${info.id} (revisão ${info.revision ?? '—'}): ${report.linked} escudos ligados, ` +
              `${report.detached} desligados e ${report.skipped} ignorados, em ${lots.length} lote(s) por país. ` +
              `Relatório de cobertura: ${formatS3Uri(uri)}.`,
            contagens: {
              ligados: report.linked,
              desligados: report.detached,
              ignorados: report.skipped,
              lotes: lots.length,
              escudosNoManifesto: manifest.logos.length,
            },
            amostra: coverage(manifest.logos)
              .slice(0, 20)
              .map((c) => ({
                pais: c.country,
                escudos: c.total,
                ligados: c.linked,
                ambiguos: c.ambiguous,
                semPar: c.unmatched,
              })),
          },
          cobertura: { s3: formatS3Uri(uri), markdown: markdown.slice(0, REPORT_IN_CHECKPOINT) },
          prova: proof,
          log: [`prévia: ${report.linked} ligados · ${report.detached} desligados · ${lots.length} lotes`],
        });
        return {
          detail: `prévia pronta: ${report.linked} ligados, ${report.detached} desligados`,
          stats: { ...report, lotes: lots.length },
        };
      }

      // a aprovação vale para o que a prévia viu: pacote ou manifesto trocado no S3 (ou o versionado mudou num deploy)
      // depois da prévia não é aplicado; quem quiser o novo roda outra prévia
      const approved = await previewProof(ctx.db, ctx.previaId);
      if (!approved)
        throw new TaskRefusedError('a prévia aprovada não guardou a prova do pacote e do manifesto');
      if (approved.pacoteSha256 !== proof.pacoteSha256)
        throw new TaskRefusedError('o pacote mudou depois da prévia aprovada: rode a prévia de novo');
      if (approved.manifestoSha256 !== proof.manifestoSha256)
        throw new TaskRefusedError('o manifesto mudou depois da prévia aprovada: rode a prévia de novo');

      const objects = d.objects();
      try {
        const from = ctx.checkpoint as { keep?: string[] } | null;
        const keep = new Set(from?.keep ?? []);
        const result = await runLots(ctx, lots, async (lot) => {
          const report = emptyImportReport();
          await importLot({ db: ctx.db, objects, manifest, dir: pkg.dir }, lot.logos, existing, report, keep);
          const { detached: _d, ...stats } = report;
          return { stats, extra: { keep: [...keep] } };
        });
        // depois do último lote: desliga quem saiu do manifesto (idempotente; uma retomada aqui só repete a conta)
        ctx.checkStop();
        const detached = await detachRemoved(ctx.db, info.id, wanted, keep);
        const totais: Record<string, number> = { ...result.totais, detached };
        await ctx.save({
          ...result.checkpoint,
          totais,
          log: appendLog(result.checkpoint, `desligados os que saíram do manifesto: ${detached}`),
        });
        return {
          detail:
            `acervo ${info.id}: ${totais.linked ?? 0} ligados · ${totais.uploaded ?? 0} gravados no storage · ` +
            `${totais.changed ?? 0} vínculos novos · ${detached} desligados · ${totais.skipped ?? 0} ignorados`,
          stats: { acervo: info.id, ...totais },
        };
      } finally {
        objects.close?.();
      }
    } finally {
      pkg.cleanup();
      manifestTmp?.cleanup();
    }
  };
}

/** Na prévia nada vai para o storage dos logos. */
const NO_OBJECTS: ObjectStore = {
  put: async () => {},
  head: async () => undefined,
  get: async () => undefined,
  delete: async () => {},
};

async function loadManifest(
  d: AcervoTaskDeps,
  params: AcervoParams,
  tmp: string | undefined,
): Promise<{ manifest: AcervoManifest; sha256: string }> {
  let path = join(d.manifestDir, `${params.acervo}.yaml`);
  if (params.manifesto) {
    const uri = parseS3Uri(params.manifesto);
    if (!uri || !tmp) throw new Error(`manifesto inválido: ${params.manifesto}`);
    path = join(tmp, `${params.acervo}.yaml`);
    if (!(await d.packages().download(uri, path)))
      throw new Error(`manifesto não encontrado no S3: ${params.manifesto}`);
  } else if (!existsSync(path)) {
    throw new Error(
      `sem manifesto versionado para ${params.acervo} (config/assets/acervo/${params.acervo}.yaml)`,
    );
  }
  const manifest = readManifest(path);
  if (manifest.acervo.id !== params.acervo)
    throw new Error(`o manifesto é do acervo ${manifest.acervo.id}, não de ${params.acervo}`);
  return { manifest, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

/** O conteúdo que a prévia viu: a execução aprovada só roda sobre o mesmo pacote e o mesmo manifesto. */
interface Proof {
  pacoteSha256: string;
  manifestoSha256: string;
}

async function previewProof(db: Database, previaId: string | null): Promise<Proof | null> {
  if (!previaId) return null;
  const [row] = await db
    .select({ checkpoint: jobRequest.checkpoint })
    .from(jobRequest)
    .where(eq(jobRequest.id, previaId));
  const proof = (row?.checkpoint as { prova?: Partial<Proof> } | null)?.prova;
  return proof?.pacoteSha256 && proof.manifestoSha256
    ? { pacoteSha256: proof.pacoteSha256, manifestoSha256: proof.manifestoSha256 }
    : null;
}
