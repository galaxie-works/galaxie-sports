/**
 * Laço de lotes das tarefas longas: cada lote é idempotente, o checkpoint é gravado depois de cada um (o último lote
 * feito e os ids dos concluídos) e o encerramento do worker é conferido entre dois lotes. Na retomada, os lotes já
 * concluídos são pulados; o que estava em andamento roda de novo, e dá o mesmo resultado.
 */
import { appendLog } from '@galaxie/db/queue-types';
import type { TaskContext } from './run.js';

export interface Lot {
  /** Estável entre tentativas: é o que marca o lote como feito no checkpoint. */
  id: string;
  /** Para o progresso e o log ("Brasil", "temporadas · liga 71"). */
  label: string;
}

export interface LotResult {
  /** Somado em `checkpoint.totais`. */
  stats?: Record<string, number>;
  /** Linha do log (padrão: o rótulo do lote e as contagens). */
  log?: string;
  /** O lote não terminou e só pode continuar depois deste instante (cota): o laço para e o lote fica pendente. */
  adiarAte?: Date;
  /** Campos livres que vão para o checkpoint (ex.: os vínculos mantidos do acervo). */
  extra?: Record<string, unknown>;
}

/** O que o laço grava no checkpoint, além das convenções do painel (`progresso`, `log`). */
export interface LotCheckpoint {
  concluidos?: string[];
  ultimoLote?: string;
  totais?: Record<string, number>;
  [key: string]: unknown;
}

export interface LotsOutcome {
  totais: Record<string, number>;
  /** Lotes concluídos (nesta tomada e nas anteriores) dentre os da lista. */
  feitos: number;
  total: number;
  /** Algum lote pediu para continuar depois. */
  adiarAte?: Date;
  checkpoint: LotCheckpoint;
}

const asCheckpoint = (v: unknown): LotCheckpoint =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as LotCheckpoint) } : {};

const summary = (stats: Record<string, number> = {}) =>
  Object.entries(stats)
    .filter(([, n]) => n)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');

/** Roda os lotes que faltam, na ordem, com checkpoint depois de cada um. */
export async function runLots<L extends Lot>(
  ctx: Pick<TaskContext, 'checkpoint' | 'save' | 'checkStop'>,
  lots: readonly L[],
  run: (lot: L, checkpoint: LotCheckpoint) => Promise<LotResult>,
): Promise<LotsOutcome> {
  let cp = asCheckpoint(ctx.checkpoint);
  const done = new Set(cp.concluidos ?? []);
  const totais: Record<string, number> = { ...(cp.totais ?? {}) };
  const ids = new Set(lots.map((l) => l.id));
  const count = () => [...done].filter((id) => ids.has(id)).length;
  for (const lot of lots) {
    if (done.has(lot.id)) continue;
    ctx.checkStop();
    const r = await run(lot, cp);
    // o que o lote gastou conta mesmo se ele ficou pela metade (chamadas de cota)
    for (const [k, n] of Object.entries(r.stats ?? {})) totais[k] = (totais[k] ?? 0) + n;
    if (r.adiarAte) {
      cp = {
        ...cp,
        ...r.extra,
        totais,
        log: appendLog(cp, `${lot.label}: ${r.log ?? 'para depois'}`),
      };
      await ctx.save(cp);
      return { totais, feitos: count(), total: lots.length, adiarAte: r.adiarAte, checkpoint: cp };
    }
    done.add(lot.id);
    cp = {
      ...cp,
      ...r.extra,
      concluidos: [...done],
      ultimoLote: lot.id,
      totais,
      progresso: { feitos: count(), total: lots.length, lote: lot.label },
      log: appendLog(cp, `${lot.label}: ${r.log ?? (summary(r.stats) || 'ok')}`),
    };
    await ctx.save(cp);
  }
  return { totais, feitos: count(), total: lots.length, checkpoint: cp };
}
