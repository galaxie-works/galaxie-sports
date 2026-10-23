/**
 * Asset Mirror (issue #18): baixa logos, bandeiras, fotos etc. da CDN de mídia da api-sports para o bucket S3.
 * Não consome cota da API de dados; a CDN tem limite por segundo/minuto, então o paralelismo é baixo.
 *
 *   pnpm --filter @galaxie/ingestor assets:mirror --plan              # quantos faltam, sem baixar
 *   pnpm --filter @galaxie/ingestor assets:mirror                     # baixa o que falta em core.asset
 *   pnpm --filter @galaxie/ingestor assets:mirror --descobrir-raw     # antes, registra toda URL de mídia do raw
 *   pnpm --filter @galaxie/ingestor assets:mirror --fotos             # só fotos de pessoas, escalados recentes primeiro
 *   pnpm --filter @galaxie/ingestor assets:mirror --so-limpeza        # só a limpeza dos logos genéricos (com --plan: prévia)
 *   opções: --limite N · --concorrencia N (padrão 3) · --pausa-ms N (padrão 250) · --retentar-ausentes
 *           --desde-dias N (com --fotos: janela dos "escalados recentes", padrão 365)
 * `--fotos` antes liga cada jogador sem foto à URL `football/players/{id}.png` (sai do id, sem cota) e, no fim,
 * aponta hashes repetidos que podem ser imagens genéricas ainda fora de PLACEHOLDER_PHOTO_SHA256.
 *           --caminho volley    só a mídia de um esporte (pasta na CDN: football, basketball, volley...)
 * Logos de time e competição que vêm como imagem genérica ("image not available", PLACEHOLDER_LOGO_SHA256) não vão
 * para o bucket: o asset fica ausente e o time ou a competição perde o logo (a demo mostra as iniciais). Toda
 * execução começa por uma limpeza idempotente: genéricos gravados antes disso viram ausentes, e times e
 * competições ligados a logos ausentes (genéricos, 404, bloqueados) perdem o vínculo; `--plan` mostra a prévia.
 * Também espelha os logos da biblioteca de emissoras (core.asset kind `broadcaster_logo`, registrados
 * pela sincronização `wtw:rights` a partir de config/broadcasters/_logos.yaml).
 *
 * Variáveis: DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, ASSETS_PUBLIC_BASE_URL.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { publicAssetUrl } from '@galaxie/apisports-client';
import { closeDb, createDb, jobRun } from '@galaxie/db';
import { loadMediaDenylist, runAssetMirror } from '../assets/asset-mirror.js';
import { PgAssetStore, type LogoCleanup } from '../assets/asset-store.js';
import { runBroadcasterLogoMirror } from '../assets/broadcaster-logos.js';
import { objectStoreFromEnv } from '../assets/object-store.js';
import { PLACEHOLDER_PHOTO_SHA256, registerPlayerPhotos } from '../assets/person-photos.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    'descobrir-raw': { type: 'boolean', default: false },
    'retentar-ausentes': { type: 'boolean', default: false },
    fotos: { type: 'boolean', default: false },
    'so-limpeza': { type: 'boolean', default: false },
    'desde-dias': { type: 'string', default: '365' },
    limite: { type: 'string' },
    concorrencia: { type: 'string', default: '3' },
    'pausa-ms': { type: 'string', default: '250' },
    caminho: { type: 'string' },
    denylist: { type: 'string', default: resolve('../../config/assets/denylist.yaml') },
  },
});

const { DATABASE_URL, ASSETS_PUBLIC_BASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');

const db = createDb(DATABASE_URL);
const assets = new PgAssetStore(db);
const denylist = await loadMediaDenylist(values.denylist);
const personPhotos = values.fotos
  ? { since: new Date(Date.now() - Number(values['desde-dias']) * 86_400_000) }
  : undefined;

try {
  if (values['descobrir-raw']) {
    const urls = await assets.discoverFromRaw();
    const added = await assets.register(urls.filter((u) => !denylist.has(u)));
    console.log(`URLs de mídia no raw: ${urls.length} · novas em core.asset: ${added}`);
  }

  if (personPhotos && !values.plan) {
    const r = await registerPlayerPhotos(db, personPhotos);
    console.log(
      `Fotos de jogador ligadas pelo id: escalados recentes ${r.linked[0]} · elenco atual ${r.linked[1]} · resto ${r.linked[2]}` +
        ` · assets novos ${r.registered} · já sabidamente sem foto ${r.skippedMissing}`,
    );
  }

  const before = await assets.counts();
  console.log(
    `core.asset: ${before.total} · espelhados: ${before.stored} · ausentes (404/bloqueados): ${before.missing} · pendentes: ${before.pending}`,
  );

  if (values['so-limpeza']) {
    const cleanup = await assets.cleanupLogos(new Date(), { dryRun: values.plan });
    console.log(logoCleanupLine(cleanup, values.plan ? 'a limpar' : 'limpos'));
  } else if (values.plan) {
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
      personPhotos,
      limit: values.limite ? Number(values.limite) : undefined,
      pathPrefix: values.caminho,
    });
    console.log(`A baixar nesta execução: ${report.pending} (nenhuma chamada à API de dados).`);
    console.log(logoCleanupLine(report.logoCleanup, 'a limpar'));
    const logos = await runBroadcasterLogoMirror({
      db,
      objects: {
        put: async () => {},
        head: async () => undefined,
        get: async () => undefined,
        delete: async () => {},
      },
      dryRun: true,
      includeMissing: values['retentar-ausentes'],
    });
    console.log(`Logos de emissoras a baixar: ${logos.pending}.`);
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
        personPhotos,
        limit: values.limite ? Number(values.limite) : undefined,
        pathPrefix: values.caminho,
        onProgress: (e) => {
          if (e.type === 'aborted') console.warn(e.reason);
          else if (++done % 100 === 0) console.log(`  ${done} processados...`);
          if (e.type === 'failed') console.warn(`  falha ${e.asset.sourceUrl}: ${e.reason}`);
        },
      });
      const logos = await runBroadcasterLogoMirror({
        db,
        objects,
        includeMissing: values['retentar-ausentes'],
      });
      for (const f of logos.failures) console.warn(`  logo de emissora ${f.url}: ${f.reason}`);
      objects.close();
      const stats = {
        ...report,
        broadcasterLogos: { ...logos, failures: logos.failures.slice(0, 20) },
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
        `Espelhados: ${report.stored} (${(report.bytes / 1024).toFixed(0)} KiB) · 404: ${report.notFound} · bloqueados: ${report.denied} · fotos genéricas: ${report.placeholders} · logos genéricos: ${report.placeholderLogos} · desvinculados: ${report.unlinked} · falhas: ${report.failed}`,
      );
      console.log(logoCleanupLine(report.logoCleanup, 'limpos'));
      if (personPhotos) await warnRepeatedPhotos();
      console.log(
        `Logos de emissoras: ${logos.stored} espelhados · 404: ${logos.notFound} · recusados: ${logos.rejected} · falhas: ${logos.failed}`,
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

function logoCleanupLine(c: LogoCleanup, verb: string): string {
  return `Logos genéricos já gravados ${verb}: ${c.placeholders} · times sem logo: ${c.participants} · competições sem logo: ${c.competitions}`;
}

/** Hash de foto de pessoa repetido em muitas pessoas costuma ser imagem genérica ainda não catalogada. */
async function warnRepeatedPhotos(): Promise<void> {
  const rows = await db.execute<{ sha256: string; n: number; url: string }>(sql`
    select sha256, count(*)::int as n, min(source_url) as url
    from core.asset
    where kind in ('player', 'coach') and sha256 is not null
    group by 1
    having count(*) >= 20
    order by 2 desc
  `);
  for (const r of rows.filter((r) => !PLACEHOLDER_PHOTO_SHA256.has(r.sha256))) {
    console.warn(`  hash repetido em ${r.n} fotos (ex.: ${r.url}): ${r.sha256} — imagem genérica?`);
  }
}
