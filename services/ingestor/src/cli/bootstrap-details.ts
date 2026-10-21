/**
 * Bootstrap do detalhe de partidas (issue #14): encerradas conhecidas pelo raw (listas de temporada, h2h,
 * agendas), priorizadas tier 1 → clássicos → tier 2. Pagos: fixtures?ids= com 20 por chamada;
 * free: fixtures?id= (1 por jogo) e, por padrão, só clássicos e jogos decisivos.
 *   pnpm --filter @galaxie/ingestor bootstrap:details --plan
 *   pnpm --filter @galaxie/ingestor bootstrap:details --sem-live
 * Opções: --escopo auto|all|key · --limite N (partidas) · --tier-max 2 · --ligas 71,13
 *         --max-chamadas N · --forcar · --por-dia N · --sem-normalizar (só grava o raw)
 * Cada detalhe buscado vai direto ao core: timeline em `event_incident`, escalações, estatísticas e
 * jogadores em `football_fixture.detail` (mesma normalização idempotente do normalize:football).
 */
import { resolve } from 'node:path';
import { closeDb } from '@galaxie/db';
import { jobContextFromEnv } from '../context.js';
import { detailsJob, type DetailScope } from '../jobs/details-job.js';
import { resolveDerbiesFromRaw } from '../knowledge/derbies.js';
import { logger } from '../logger.js';
import { normalizeAfterFetch } from '../normalize/after-fetch.js';
import { intOption, listOption, parseCli, planOrRun, runCli } from './job-cli.js';

const knowledgeDir = resolve('../../data/knowledge');

await runCli(async () => {
  const { values } = parseCli({
    escopo: { type: 'string', default: 'auto' },
    limite: { type: 'string' },
    'tier-max': { type: 'string' },
    ligas: { type: 'string' },
    'sem-normalizar': { type: 'boolean', default: false },
  });
  if (!['auto', 'all', 'key'].includes(values.escopo)) throw new Error('--escopo deve ser auto, all ou key.');
  const ctx = jobContextFromEnv();
  try {
    const derbyKeys = async () => {
      const r = await resolveDerbiesFromRaw(knowledgeDir, ctx.raw);
      return new Set(r.pairs.map((p) => p.key));
    };
    const spec = detailsJob(ctx.catalog, ctx.raw, ctx.cursors, ctx.plan, derbyKeys, {
      scope: values.escopo as DetailScope,
      limit: intOption(values.limite, 'limite'),
      maxTier: intOption(values['tier-max'], 'tier-max'),
      leagues: listOption(values.ligas),
    });
    const normalize = values['sem-normalizar']
      ? undefined
      : normalizeAfterFetch(ctx.db, {
          onError: (err, endpoint, params) =>
            logger.warn(
              { err, endpoint, params },
              'falha ao normalizar detalhe; o normalize:football tenta de novo',
            ),
        });
    const report = await planOrRun(ctx, spec, values, normalize ? { afterFetch: normalize.afterFetch } : {});
    if (report && normalize) {
      const n = normalize.report();
      console.log(
        `Core: ${n.normalized} resposta(s) normalizadas (${n.stats.events.updated + n.stats.events.inserted} eventos, ${n.stats.incidents} incidentes) · ${n.errors} com erro.`,
      );
    }
  } finally {
    await closeDb(ctx.db);
  }
});
