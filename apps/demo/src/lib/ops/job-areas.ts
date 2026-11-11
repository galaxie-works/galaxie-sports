/**
 * Área de cada job na Agenda dos jobs (#1075): a tabela agrupa por ao vivo, dados, IA, conteúdo e manutenção. Puro
 * (sem servidor nem React); o teste confere que todo job do registro tem área.
 */
import { SCHEDULED_JOBS } from '@galaxie/runtime-config';

import { compareAlpha } from '@/lib/alphabetical';

export const JOB_AREAS = ['live', 'data', 'ai', 'content', 'maintenance'] as const;
export type JobArea = (typeof JOB_AREAS)[number];

const AREA_OF: Readonly<Record<string, JobArea>> = {
  // ao vivo: o placar e o relógio dos jogos em andamento e o fechamento logo depois do apito
  'live-run': 'live',
  'live-reconcile': 'live',
  'events-clock': 'live',
  'postgame-close': 'live',
  // dados: a carga da api-sports e o que sai dela
  'sync-daily': 'data',
  'sync-mirror': 'data',
  'normalize-football': 'data',
  'normalize-sports': 'data',
  'events-importance': 'data',
  'explore-summary': 'data',
  'fixture-people': 'data',
  'bootstrap-catalog': 'data',
  // IA: os agentes
  'recap-run': 'ai',
  'context-run': 'ai',
  'wtw-run': 'ai',
  'wtw-channel': 'ai',
  'wtw-rights': 'ai',
  'related-run': 'ai',
  'review-suggestions': 'ai',
  'channel-lists': 'ai',
  'lineups-revisit': 'ai',
  // conteúdo: páginas, escudos e a Cosmos
  'lineups-pages': 'content',
  'assets-mirror': 'content',
  'assets-palette': 'content',
  'cosmos-upkeep': 'content',
  // manutenção: limpeza, cota e qualidade
  'change-feed-prune': 'maintenance',
  'data-retention': 'maintenance',
  'quota-status': 'maintenance',
  'data-quality': 'maintenance',
};

/** Área do job; um job novo sem área cai em manutenção (o teste avisa antes). */
export const jobArea = (job: string): JobArea => AREA_OF[job] ?? 'maintenance';

/** Os jobs que têm área declarada (para o teste). */
export const jobsWithArea = (): string[] => SCHEDULED_JOBS.map((j) => j.name).filter((n) => n in AREA_OF);

/**
 * As linhas agrupadas na ordem fixa das áreas e, dentro de cada uma, em ordem alfabética do rótulo. A busca casa com
 * o rótulo, o nome do job e a chave, sem diferenciar acento nem caixa. Áreas vazias ficam de fora.
 */
export function groupJobs<T extends { job: string; label: string; key: string }>(
  rows: readonly T[],
  query = '',
): { area: JobArea; rows: T[] }[] {
  const q = fold(query.trim());
  const hit = (r: T) => !q || [r.label, r.job, r.key].some((v) => fold(v).includes(q));
  return JOB_AREAS.map((area) => ({
    area,
    rows: rows
      .filter((r) => jobArea(r.job) === area && hit(r))
      .sort((a, b) => compareAlpha(a.label, b.label)),
  })).filter((g) => g.rows.length > 0);
}

const fold = (v: string) =>
  v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
