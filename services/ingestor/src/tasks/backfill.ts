/**
 * Backfills manuais de mais de um minuto como tarefas da fila, sem chamada ao fornecedor:
 *
 * - `backfill.normalizar`: o `normalize:football --tudo`, um endpoint do raw por lote (reprocessar o mesmo endpoint
 *   dá o mesmo core; o cursor incremental não anda, como no `--endpoints` da CLI).
 * - `backfill.tabelas`: o `standings:recompute`, em lotes de temporadas.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import { apiResponse, type Database } from '@galaxie/db';
import { runNormalizeFootballJob } from '../normalize/raw-runner.js';
import { recomputeStandings, seasonsWithNewResults } from '../standings/recompute.js';
import { runLots, type Lot } from './lotes.js';
import type { TaskHandler } from './run.js';

// ── backfill.normalizar ──────────────────────────────────────────────────────────────────────────

export interface NormalizarDeps {
  /** Endpoints do raw do futebol, com quantas respostas cada. */
  endpoints: (db: Database) => Promise<{ endpoint: string; respostas: number }[]>;
  run: (db: Database, endpoint: string) => Promise<{ respostas: number; erros: number }>;
}

export const normalizarDeps: NormalizarDeps = {
  endpoints: async (db) => {
    const rows = await db
      .select({ endpoint: apiResponse.endpoint, respostas: sql<number>`count(*)::int` })
      .from(apiResponse)
      .where(and(eq(apiResponse.provider, 'api-sports'), eq(apiResponse.sport, 'football')))
      .groupBy(apiResponse.endpoint)
      .orderBy(asc(apiResponse.endpoint));
    return rows;
  },
  run: async (db, endpoint) => {
    const r = await runNormalizeFootballJob(db, { full: true, endpoints: [endpoint] });
    return { respostas: r.rows.length, erros: r.rows.filter((x) => x.outcome === 'error').length };
  },
};

export function backfillNormalizar(deps: NormalizarDeps = normalizarDeps): TaskHandler {
  return async (ctx) => {
    const wanted = (ctx.params.endpoints as string[] | undefined) ?? undefined;
    const all = await deps.endpoints(ctx.db);
    const list = wanted ? all.filter((e) => wanted.includes(e.endpoint)) : all;
    const lots = list.map((e) => ({ id: `endpoint:${e.endpoint}`, label: e.endpoint, ...e }));
    if (ctx.previa) {
      const respostas = list.reduce((n, e) => n + e.respostas, 0);
      const fora = (wanted ?? []).filter((w) => !all.some((e) => e.endpoint === w));
      await ctx.save({
        previa: {
          resumo:
            `Reprocessaria ${respostas} resposta(s) do raw do futebol em ${lots.length} lote(s), um por endpoint. ` +
            'Nenhuma chamada ao fornecedor.' +
            (fora.length ? ` Sem raw: ${fora.join(', ')}.` : ''),
          contagens: { lotes: lots.length, respostas },
          amostra: list.slice(0, 20),
        },
      });
      return { detail: `prévia pronta: ${respostas} respostas`, stats: { lotes: lots.length, respostas } };
    }
    const result = await runLots(ctx, lots, async (lot) => {
      const r = await deps.run(ctx.db, lot.endpoint);
      return { stats: r, log: `${r.respostas} resposta(s)${r.erros ? ` · ${r.erros} com erro` : ''}` };
    });
    const erros = result.totais.erros ?? 0;
    return {
      detail:
        `normalizados ${result.totais.respostas ?? 0} respostas em ${result.total} endpoint(s)` +
        (erros ? ` · ${erros} com erro (ops.normalize_failure)` : ''),
      stats: result.totais,
    };
  };
}

// ── backfill.tabelas ─────────────────────────────────────────────────────────────────────────────

export interface TabelasDeps {
  /** Temporadas com resultado novo nos últimos `dias`. */
  seasons: (db: Database, dias: number) => Promise<string[]>;
  recompute: (db: Database, seasonIds: readonly string[]) => Promise<{ outcome: string }[]>;
}

export const tabelasDeps: TabelasDeps = {
  seasons: (db, dias) => seasonsWithNewResults(db, new Date(Date.now() - dias * 86_400_000)),
  recompute: (db, seasonIds) =>
    recomputeStandings(db, { seasonIds, rulesDir: resolve('../../config/rules'), publish: true }),
};

/** Lotes de temporadas; o id resume o conteúdo (lista que mudou entre tentativas refaz o lote, sem pular nada). */
export function seasonLots(ids: readonly string[], size: number): (Lot & { seasons: string[] })[] {
  const sorted = [...new Set(ids)].sort();
  const lots: (Lot & { seasons: string[] })[] = [];
  for (let i = 0; i < sorted.length; i += size) {
    const seasons = sorted.slice(i, i + size);
    const digest = createHash('sha256').update(seasons.join(',')).digest('hex').slice(0, 12);
    lots.push({
      id: `temporadas:${digest}`,
      label: `temporadas ${i + 1}–${i + seasons.length} de ${sorted.length}`,
      seasons,
    });
  }
  return lots;
}

export function backfillTabelas(deps: TabelasDeps = tabelasDeps): TaskHandler {
  return async (ctx) => {
    const p = ctx.params as { dias: number; temporadas?: string[]; lote: number };
    const ids = p.temporadas ?? (await deps.seasons(ctx.db, p.dias));
    const lots = seasonLots(ids, p.lote);
    if (ctx.previa) {
      await ctx.save({
        previa: {
          resumo:
            `Recalcularia ${ids.length} temporada(s) em ${lots.length} lote(s) de até ${p.lote}, a partir dos ` +
            'resultados do core. Nenhuma chamada ao fornecedor.',
          contagens: { temporadas: ids.length, lotes: lots.length },
          amostra: ids.slice(0, 20),
        },
      });
      return { detail: `prévia pronta: ${ids.length} temporadas`, stats: { temporadas: ids.length } };
    }
    const result = await runLots(ctx, lots, async (lot) => {
      const reports = await deps.recompute(ctx.db, lot.seasons);
      const stats: Record<string, number> = { temporadas: reports.length };
      for (const r of reports) stats[r.outcome] = (stats[r.outcome] ?? 0) + 1;
      return { stats };
    });
    return {
      detail: `tabelas recalculadas: ${result.totais.temporadas ?? 0} temporada(s) em ${result.total} lote(s)`,
      stats: result.totais,
    };
  };
}
