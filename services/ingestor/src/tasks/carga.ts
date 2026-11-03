/**
 * `carga.historica` (#417): os bootstraps do futebol como tarefa da fila. Lotes na ordem das etapas: temporadas e
 * detalhes uma liga por lote, pessoas e perfis num lote cada. Cada lote é um `runJob` de verdade (cursores em
 * ops.sync_cursor, raw como cache), então repetir um lote não gasta cota de novo no que já foi feito.
 *
 * A cota do dia acabou (o Quota Governor parou o lote, ou o fornecedor respondeu `quota_exhausted`): a tarefa não
 * falha. O lote fica pendente, o checkpoint guarda os concluídos, e o `finish` devolve a tarefa à fila para o próximo
 * dia de cota (00:30 UTC; o dia de cota vira às 00:00 UTC). Limite de requisições do fornecedor: volta em 15 min.
 */
import { resolve } from 'node:path';
import { closeDb } from '@galaxie/db';
import { CARGA_ETAPAS, type CargaEtapa } from '@galaxie/db/queue-types';
import { jobContextFromEnv, type JobContext } from '../context.js';
import { detailsJob } from '../jobs/details-job.js';
import { peopleJob } from '../jobs/people-job.js';
import { profilesJob, profileTargets } from '../jobs/profiles-job.js';
import { planJob, runJob, type JobReport, type JobSpec } from '../jobs/runtime/runner.js';
import { seasonsJob } from '../jobs/seasons-job.js';
import { planDayWithoutLive } from '../cli/job-cli.js';
import { resolveDerbiesFromRaw } from '../knowledge/derbies.js';
import { normalizeAfterFetch } from '../normalize/after-fetch.js';
import { runLots, type Lot } from './lotes.js';
import type { TaskHandler } from './run.js';

export interface CargaParams {
  etapas: CargaEtapa[];
  tierMax: number;
  ligas?: number[];
  semLive: boolean;
  maxChamadasPorLote?: number;
}

export interface CargaLot extends Lot {
  etapa: CargaEtapa;
  /** Liga da api-sports (temporadas e detalhes); pessoas e perfis rodam num lote só. */
  liga?: number;
}

export interface CargaLotRun {
  /** `cota`: o dia acabou; `pausa`: o fornecedor pediu para esperar; `limite`: bateu o teto do lote. */
  status: 'ok' | 'cota' | 'pausa' | 'limite';
  chamadas: number;
  /** Itens que ficaram para depois neste lote. */
  pendentes: number;
  detalhe?: string;
}

export interface CargaDeps {
  lots: (p: CargaParams) => Promise<CargaLot[]>;
  /** Prévia de um lote: quanto gastaria de cota, sem chamar o fornecedor. */
  plan: (lot: CargaLot, p: CargaParams) => Promise<{ rede: number; cache: number; feitos: number }>;
  run: (lot: CargaLot, p: CargaParams) => Promise<CargaLotRun>;
  /** `semLive`: planeja o dia sem ao vivo, para a folga ir para a carga. */
  prepareDay: () => Promise<void>;
  close: () => Promise<void>;
}

/** Próximo dia de cota: 00:30 UTC do dia seguinte (o dia vira às 00:00 UTC; meia hora para o sync diário começar). */
export function nextQuotaDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 30));
}

/** Pausa quando o fornecedor responde `rate_limited`. */
export const RATE_LIMIT_PAUSE_MS = 15 * 60_000;

const ETAPA_LABEL: Record<CargaEtapa, string> = {
  temporadas: 'temporadas',
  detalhes: 'detalhes',
  pessoas: 'pessoas e elencos',
  perfis: 'perfis',
};

/** Lotes na ordem das etapas pedidas; temporadas e detalhes, uma liga por lote. */
export function cargaLots(p: Pick<CargaParams, 'etapas'>, leagues: readonly number[]): CargaLot[] {
  const out: CargaLot[] = [];
  for (const etapa of CARGA_ETAPAS) {
    if (!p.etapas.includes(etapa)) continue;
    if (etapa === 'temporadas' || etapa === 'detalhes')
      for (const liga of leagues)
        out.push({ id: `${etapa}:${liga}`, label: `${ETAPA_LABEL[etapa]} · liga ${liga}`, etapa, liga });
    else out.push({ id: etapa, label: ETAPA_LABEL[etapa], etapa });
  }
  return out;
}

/** O desfecho de um `runJob` para a tarefa: cota e pausa voltam depois; erro do fornecedor que não é de cota, falha. */
export function lotOutcome(report: JobReport): CargaLotRun {
  const base = { chamadas: report.callsSpent, pendentes: report.totals.pending };
  if (report.status === 'ok') return { status: 'ok', ...base };
  const reason = report.reason ?? '';
  if (report.stoppedBy === 'quota' || /quota_exhausted/.test(reason))
    return { status: 'cota', ...base, detalhe: reason };
  if (/rate_limited/.test(reason)) return { status: 'pausa', ...base, detalhe: reason };
  if (report.stoppedBy === 'max_calls') return { status: 'limite', ...base, detalhe: reason };
  throw new Error(`${report.job}: ${reason || 'parou com erro do fornecedor'}`);
}

const knowledgeDir = () => resolve('../../data/knowledge');

/** Dependências de verdade: o contexto dos jobs (banco, cliente da api-sports, Quota Governor). */
export function cargaEnvDeps(): CargaDeps {
  let ctx: JobContext | undefined;
  const job = () => (ctx ??= jobContextFromEnv());
  const spec = (lot: CargaLot, p: CargaParams): { spec: JobSpec; normalize: boolean } => {
    const c = job();
    switch (lot.etapa) {
      case 'temporadas':
        return {
          spec: seasonsJob(c.catalog, c.raw, c.plan, c.now, { maxTier: p.tierMax, leagues: [lot.liga!] }),
          normalize: false,
        };
      case 'detalhes':
        return {
          spec: detailsJob(
            c.catalog,
            c.raw,
            c.cursors,
            c.plan,
            async () => new Set((await resolveDerbiesFromRaw(knowledgeDir(), c.raw)).pairs.map((x) => x.key)),
            { maxTier: p.tierMax, leagues: [lot.liga!] },
          ),
          normalize: true,
        };
      case 'pessoas':
        return {
          spec: peopleJob(
            c.catalog,
            c.raw,
            c.cursors,
            c.plan,
            c.now,
            async () => (await resolveDerbiesFromRaw(knowledgeDir(), c.raw)).pairs.map((x) => x.key),
            { teamMaxTier: p.tierMax },
          ),
          normalize: false,
        };
      case 'perfis':
        return {
          spec: profilesJob(() =>
            profileTargets(c.db, { since: new Date('2026-01-01T00:00:00Z'), maxTier: p.tierMax }),
          ),
          normalize: true,
        };
    }
  };
  return {
    lots: async (p) => {
      const leagues = p.ligas ?? [
        ...new Set((await job().catalog.competitions(p.tierMax)).map((c) => c.leagueId)),
      ];
      return cargaLots(p, leagues);
    },
    plan: async (lot, p) => {
      const t = (await planJob(spec(lot, p).spec, job())).totals;
      return { rede: t.network, cache: t.cache, feitos: t.done };
    },
    run: async (lot, p) => {
      const { spec: s, normalize } = spec(lot, p);
      const after = normalize ? normalizeAfterFetch(job().db) : undefined;
      return lotOutcome(
        await runJob(s, job(), {
          maxCalls: p.maxChamadasPorLote,
          ...(after ? { afterFetch: after.afterFetch } : {}),
        }),
      );
    },
    prepareDay: () => planDayWithoutLive(job().governor),
    close: async () => {
      if (ctx) await closeDb(ctx.db);
    },
  };
}

export function cargaHistorica(
  makeDeps: () => CargaDeps = cargaEnvDeps,
  now: () => Date = () => new Date(),
): TaskHandler {
  return async (ctx) => {
    const p = ctx.params as unknown as CargaParams;
    const deps = makeDeps();
    try {
      const lots = await deps.lots(p);
      if (ctx.previa) {
        const totals = { rede: 0, cache: 0, feitos: 0 };
        const amostra: { lote: string; rede: number; cache: number }[] = [];
        for (const lot of lots) {
          ctx.checkStop();
          const t = await deps.plan(lot, p);
          totals.rede += t.rede;
          totals.cache += t.cache;
          totals.feitos += t.feitos;
          if (t.rede && amostra.length < 20) amostra.push({ lote: lot.label, rede: t.rede, cache: t.cache });
        }
        await ctx.save({
          previa: {
            resumo:
              `${lots.length} lote(s) (${p.etapas.join(', ')}; tier até ${p.tierMax}). Gastaria ~${totals.rede} ` +
              `chamada(s) de cota; ${totals.cache} vêm do raw e ${totals.feitos} já estão feitas. As fases que ` +
              `dependem da anterior são estimadas por baixo.`,
            contagens: { lotes: lots.length, ...totals },
            amostra,
          },
        });
        return { detail: `prévia pronta: ~${totals.rede} chamadas em ${lots.length} lotes`, stats: totals };
      }

      if (p.semLive) await deps.prepareDay();
      const result = await runLots(ctx, lots, async (lot) => {
        const r = await deps.run(lot, p);
        const stats = { chamadas: r.chamadas };
        if (r.status === 'cota')
          return {
            stats,
            adiarAte: nextQuotaDay(now()),
            log: `cota do dia esgotada (${r.chamadas} chamadas)`,
          };
        if (r.status === 'pausa')
          return {
            stats,
            adiarAte: new Date(now().getTime() + RATE_LIMIT_PAUSE_MS),
            log: 'o fornecedor pediu pausa (rate limit)',
          };
        return {
          stats: { ...stats, pendentes: r.pendentes },
          log:
            `${r.chamadas} chamada(s)` +
            (r.status === 'limite' ? ` · teto do lote: ${r.pendentes} item(ns) para a próxima carga` : ''),
        };
      });
      const chamadas = result.totais.chamadas ?? 0;
      if (result.adiarAte)
        return {
          detail:
            `${result.feitos}/${result.total} lotes; ${chamadas} chamada(s) até aqui. ` +
            `Continua em ${result.adiarAte.toISOString()}.`,
          stats: { ...result.totais, lotes: result.feitos, total: result.total },
          runAfter: result.adiarAte,
        };
      return {
        detail: `carga concluída: ${result.total} lote(s), ${chamadas} chamada(s)`,
        stats: { ...result.totais, lotes: result.total },
      };
    } finally {
      await deps.close();
    }
  };
}
