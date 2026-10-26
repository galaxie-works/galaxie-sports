import type { AssetStore } from './asset-store.js';
import type { ObjectStore } from './object-store.js';
import { paletteFromPng, type AssetPalette } from './palette.js';

/** Paletas gravadas por transação. */
const SAVE_BATCH = 500;

export interface PaletteBackfillOptions {
  assets: AssetStore;
  objects: ObjectStore;
  /**
   * Máximo de paletas gravadas nesta execução. Os que não decodificam não contam: a fila segue depois deles,
   * para que falhas permanentes (JPEG com extensão .png etc.) não ocupem o lote de toda execução.
   */
  limit?: number | undefined;
  /** Só conta os candidatos, sem ler o storage nem gravar. */
  dryRun?: boolean;
  onProgress?: (event: PaletteEvent) => void;
}

export type PaletteEvent =
  | { type: 'saved'; id: string; storageKey: string; palette: AssetPalette }
  | { type: 'skipped'; id: string; storageKey: string; reason: string };

export interface PaletteBackfillReport {
  /** Candidatos lidos (no dryRun: até `limit`). */
  candidates: number;
  saved: number;
  monochrome: number;
  /** Objeto ausente no storage ou PNG que o decodificador não suporta (entrelaçado, corrompido). */
  skipped: number;
}

/**
 * Backfill das cores dos times: para cada team_logo já espelhado em PNG e sem `palette`, lê o objeto
 * do bucket e grava a paleta. Zero chamadas ao fornecedor (nem à CDN de mídia) — só storage e banco.
 * Os que não decodificam continuam nulos e voltam a ser candidatos na próxima execução (sem ocupar o `limit`).
 */
export async function runPaletteBackfill(options: PaletteBackfillOptions): Promise<PaletteBackfillReport> {
  const emit = options.onProgress ?? (() => {});
  const report: PaletteBackfillReport = { candidates: 0, saved: 0, monochrome: 0, skipped: 0 };
  if (options.dryRun) {
    report.candidates = (await options.assets.paletteCandidates(options.limit)).length;
    return report;
  }

  // grava em lotes numa transação: os times do lote são purgados do cache de uma vez (change feed)
  let batch: { id: string; palette: AssetPalette }[] = [];
  const flush = async () => {
    if (batch.length) await options.assets.savePalettes(batch);
    batch = [];
  };
  let after: string | undefined;
  for (;;) {
    const wanted = options.limit === undefined ? undefined : options.limit - report.saved;
    if (wanted !== undefined && wanted <= 0) break;
    const page = await options.assets.paletteCandidates(wanted, after);
    report.candidates += page.length;
    for (const item of page) {
      const body = await options.objects.get(item.storageKey);
      const palette = body && paletteFromPng(body);
      if (!palette) {
        report.skipped += 1;
        emit({
          type: 'skipped',
          ...item,
          reason: body ? 'PNG não suportado ou sem pixels opacos' : 'objeto ausente no storage',
        });
        continue;
      }
      batch.push({ id: item.id, palette });
      if (batch.length >= SAVE_BATCH) await flush();
      report.saved += 1;
      if (palette.monochrome) report.monochrome += 1;
      emit({ type: 'saved', ...item, palette });
    }
    await flush();
    // sem limite a primeira página já traz tudo; com limite, uma página incompleta é o fim da fila
    if (wanted === undefined || page.length < wanted) break;
    after = page.at(-1)!.id;
  }
  return report;
}
