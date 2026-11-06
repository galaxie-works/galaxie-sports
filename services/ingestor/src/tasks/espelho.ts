/**
 * `assets.espelhar`: o `mirror-assets` como tarefa da fila. Lotes de `lote` assets até `limite`, cada um continuando
 * do cursor por tipo de asset em ops.sync_cursor (o mesmo do job do scheduler); o checkpoint guarda quantos já foram e
 * as contagens. A limpeza (bloqueados, genéricos) roda só no primeiro lote. A CDN pedindo pausa (429 seguidos) não é
 * falha: a tarefa volta à fila daqui a 30 min.
 */
import { resolve } from 'node:path';
import type { Database } from '@galaxie/db';
import { appendLog } from '@galaxie/db/queue-types';
import {
  loadMediaDenylist,
  runAssetMirror,
  type AssetMirrorOptions,
  type MirrorCursorStore,
  type MirrorReport,
} from '../assets/asset-mirror.js';
import { PgAssetStore, runRawDiscovery } from '../assets/asset-store.js';
import { runBroadcasterLogoMirror } from '../assets/broadcaster-logos.js';
import { mirrorCursorStore } from '../assets/mirror-cursor.js';
import { objectStoreFromEnv } from '../assets/object-store.js';
import { relinkRecoveredLogos } from '../assets/relink-logos.js';
import { PgCursorStore } from '../jobs/runtime/cursor-store.js';
import type { TaskHandler } from './run.js';

type MirrorCall = Pick<
  AssetMirrorOptions,
  'limit' | 'includeMissing' | 'pathPrefix' | 'concurrency' | 'skipCleanup' | 'dryRun' | 'signal' | 'cursor'
>;

export interface EspelhoDeps {
  /** O `runAssetMirror` com o storage, a lista de bloqueio e o banco já ligados. */
  mirror: (call: MirrorCall) => Promise<MirrorReport>;
  cursor: (scope: {
    pathPrefix?: string | undefined;
    includeMissing?: boolean | undefined;
  }) => MirrorCursorStore;
  /** Registra as URLs de mídia do raw novo. */
  discover: () => Promise<{ urls: number; added: number }>;
  /** No fim: religa os logos que voltaram e espelha os logos de emissoras. */
  finish: (recovered: readonly string[]) => Promise<string>;
  close: () => void;
}

export async function espelhoEnvDeps(db: Database): Promise<EspelhoDeps> {
  const assets = new PgAssetStore(db);
  const denylist = await loadMediaDenylist(resolve('../../config/assets/denylist.yaml'));
  let objects: ReturnType<typeof objectStoreFromEnv> | undefined;
  const store = () => (objects ??= objectStoreFromEnv());
  const cursors = new PgCursorStore(db);
  return {
    mirror: (call) =>
      runAssetMirror({
        assets,
        objects: call.dryRun
          ? {
              put: async () => {},
              head: async () => undefined,
              get: async () => undefined,
              delete: async () => {},
            }
          : store(),
        denylist,
        ...call,
      }),
    cursor: (scope) => mirrorCursorStore(cursors, scope),
    discover: () => runRawDiscovery(db, assets, { denylist }),
    finish: async (recovered) => {
      const relinked = recovered.length ? await relinkRecoveredLogos(db, recovered) : undefined;
      const logos = await runBroadcasterLogoMirror({ db, objects: store() });
      return (
        (relinked
          ? `religados ${relinked.participants} times e ${relinked.competitions} competições · `
          : '') + `logos de emissoras: ${logos.stored} espelhados, ${logos.failed} falhas`
      );
    },
    close: () => objects?.close(),
  };
}

interface EspelhoParams {
  limite: number;
  lote: number;
  descobrirRaw: boolean;
  retentarAusentes: boolean;
  caminho?: string;
  concorrencia: number;
}

interface EspelhoCheckpoint {
  descoberto?: boolean;
  limpo?: boolean;
  feitos?: number;
  recuperados?: string[];
  totais?: Record<string, number>;
  [key: string]: unknown;
}

const COUNTED = [
  'stored',
  'notFound',
  'denied',
  'placeholders',
  'placeholderLogos',
  'placeholderImages',
  'failed',
  'errors',
] as const;

/** Pausa quando a CDN responde 429 em sequência. */
export const CDN_PAUSE_MS = 30 * 60_000;

export function assetsEspelhar(
  makeDeps: (db: Database) => Promise<EspelhoDeps> = espelhoEnvDeps,
  now: () => Date = () => new Date(),
): TaskHandler {
  return async (ctx) => {
    const p = ctx.params as unknown as EspelhoParams;
    const deps = await makeDeps(ctx.db);
    const scope = { pathPrefix: p.caminho, includeMissing: p.retentarAusentes };
    try {
      if (ctx.previa) {
        const r = await deps.mirror({ ...scope, dryRun: true, limit: p.limite });
        await ctx.save({
          previa: {
            resumo: `Espelharia até ${r.pending} asset(s) (limite ${p.limite}), em lotes de ${p.lote}, sem gastar cota da API.`,
            contagens: {
              pendentes: r.pending,
              lotes: Math.ceil(r.pending / p.lote),
              logosGenericosALimpar: r.logoCleanup.placeholders,
              timesSemLogo: r.logoCleanup.participants,
              competicoesSemLogo: r.logoCleanup.competitions,
              imagensGenericasALimpar: r.imageCleanup.placeholders,
              estadiosSemImagem: r.imageCleanup.venues,
            },
            amostra: [],
          },
        });
        return { detail: `prévia pronta: ${r.pending} pendentes`, stats: { pendentes: r.pending } };
      }

      let cp: EspelhoCheckpoint = { ...((ctx.checkpoint as EspelhoCheckpoint | null) ?? {}) };
      const save = async (next: EspelhoCheckpoint, line: string) => {
        cp = { ...next, log: appendLog(cp, line) };
        await ctx.save(cp);
      };
      if (p.descobrirRaw && !cp.descoberto) {
        const d = await deps.discover();
        await save({ ...cp, descoberto: true }, `raw: ${d.urls} URLs de mídia, ${d.added} novas`);
      }
      const cursor = deps.cursor(scope);
      const totais: Record<string, number> = { ...(cp.totais ?? {}) };
      const recovered = [...(cp.recuperados ?? [])];
      let feitos = cp.feitos ?? 0;
      let lote = 0;
      while (feitos < p.limite) {
        ctx.checkStop();
        const n = Math.min(p.lote, p.limite - feitos);
        const r = await deps.mirror({
          ...scope,
          limit: n,
          concurrency: p.concorrencia,
          skipCleanup: !!cp.limpo,
          cursor,
          signal: ctx.signal,
        });
        const handled =
          r.stored +
          r.notFound +
          r.denied +
          r.placeholders +
          r.placeholderLogos +
          r.placeholderImages +
          r.failed;
        feitos += r.cursor?.interrompida ? handled : r.pending;
        for (const k of COUNTED) totais[k] = (totais[k] ?? 0) + r[k];
        recovered.push(...r.recoveredLogos);
        lote += 1;
        await save(
          {
            ...cp,
            limpo: true,
            feitos,
            totais,
            recuperados: recovered,
            progresso: { feitos, total: p.limite, lote: `lote ${lote}` },
          },
          `lote ${lote}: ${r.stored} espelhados · ${r.notFound} 404 · ${r.failed} falhas`,
        );
        // SIGTERM no meio do lote: o cursor e o checkpoint já foram gravados, a tarefa volta à fila
        ctx.checkStop();
        if (r.aborted) {
          return {
            detail: `${r.aborted} Volta em 30 min.`,
            stats: totais,
            runAfter: new Date(now().getTime() + CDN_PAUSE_MS),
          };
        }
        if (r.cursor?.fimDaVolta || r.pending < n) break;
      }
      const fim = await deps.finish(recovered);
      await save({ ...cp }, fim);
      return {
        detail: `espelhados ${totais.stored ?? 0} · 404 ${totais.notFound ?? 0} · falhas ${totais.failed ?? 0} · ${fim}`,
        stats: { ...totais, feitos },
      };
    } finally {
      deps.close();
    }
  };
}
