import type { AssetStore } from './asset-store.js';
import type { ObjectStore } from './object-store.js';
import { paletteFromPng, type AssetPalette } from './palette.js';

export interface PaletteBackfillOptions {
  assets: AssetStore;
  objects: ObjectStore;
  /** Máximo de escudos nesta execução. */
  limit?: number | undefined;
  /** Só conta os candidatos, sem ler o storage nem gravar. */
  dryRun?: boolean;
  onProgress?: (event: PaletteEvent) => void;
}

export type PaletteEvent =
  | { type: 'saved'; id: string; storageKey: string; palette: AssetPalette }
  | { type: 'skipped'; id: string; storageKey: string; reason: string };

export interface PaletteBackfillReport {
  candidates: number;
  saved: number;
  monochrome: number;
  /** Objeto ausente no storage ou PNG que o decodificador não suporta (entrelaçado, corrompido). */
  skipped: number;
}

/**
 * Backfill das cores dos times: para cada team_logo já espelhado em PNG e sem `palette`, lê o objeto
 * do bucket e grava a paleta. Zero chamadas ao fornecedor (nem à CDN de mídia) — só storage e banco.
 * Os que não decodificam continuam nulos e voltam a ser candidatos na próxima execução.
 */
export async function runPaletteBackfill(options: PaletteBackfillOptions): Promise<PaletteBackfillReport> {
  const emit = options.onProgress ?? (() => {});
  const queue = await options.assets.paletteCandidates(options.limit);
  const report: PaletteBackfillReport = { candidates: queue.length, saved: 0, monochrome: 0, skipped: 0 };
  if (options.dryRun) return report;

  for (const item of queue) {
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
    await options.assets.savePalette(item.id, palette);
    report.saved += 1;
    if (palette.monochrome) report.monochrome += 1;
    emit({ type: 'saved', ...item, palette });
  }
  return report;
}
