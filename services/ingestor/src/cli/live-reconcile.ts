/**
 * Reconciliação do ao vivo: confirma pelo detalhe (`fixtures?id=`, prioridade LIVE) todo jogo que o core
 * ainda dá como em andamento e grava status, placar e encerramento. Rede de segurança do scheduler e
 * "botão de pânico" do painel de Operação — não depende do plano nem do processo do ao vivo.
 *   pnpm --filter @galaxie/ingestor live:reconcile --plan     # quais jogos seriam conferidos (nada é chamado)
 *   pnpm --filter @galaxie/ingestor live:reconcile            # confere e corrige
 * Opções: --esporte football · --horas 6 (jogos que começaram até N horas atrás) · --max 60 (chamadas)
 *         · --sem-publicar · --sem-tabelas
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { ApiSportsProvider } from '@galaxie/providers';
import { contextFromEnv } from '../context.js';
import { PgCursorStore } from '../jobs/runtime/cursor-store.js';
import { PgJobRunStore } from '../jobs/runtime/job-run-store.js';
import { reconcileLive, reconcileTargets } from '../live/reconcile.js';
import { PgLiveStore } from '../live/store.js';
import { logger, report } from '../logger.js';
import { recomputeStandings } from '../standings/recompute.js';
import { runCli } from './job-cli.js';

const rulesDir = resolve('../../config/rules');
const log = logger.child({ component: 'live-reconcile' });

function positive(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${flag} precisa ser um número > 0 (recebido: ${value}).`);
  return n;
}

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      esporte: { type: 'string', default: 'football' },
      horas: { type: 'string', default: '6' },
      max: { type: 'string', default: '60' },
      'sem-publicar': { type: 'boolean', default: false },
      'sem-tabelas': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const sport = values.esporte;
  const lookbackHours = positive(values.horas, '--horas');
  const max = positive(values.max, '--max');
  const ctx = contextFromEnv();
  const now = new Date();

  try {
    if (values.plan) {
      const store = new PgLiveStore(ctx.db, { publish: false });
      const candidates = await store.candidates(
        sport,
        'api-sports',
        new Date(now.getTime() - lookbackHours * 3_600_000),
        now,
      );
      const targets = reconcileTargets(candidates, now, lookbackHours);
      report(
        `Em andamento no core (${targets.length}; conferidos até ${max})`,
        targets.map((c) => ({
          jogo: c.label ?? c.eventId,
          status: c.statusDetail ?? c.status,
          apito_utc: c.startsAt.toISOString().slice(11, 16),
          prioridade: c.livePriority,
          fornecedor: c.providerEventId,
        })),
      );
      return;
    }

    if (ctx.offline) throw new Error('Sem APISPORTS_KEY não há fonte para conferir (use --plan).');
    if (!new ApiSportsProvider(ctx.client).supports(sport))
      throw new Error(`Ainda não há provedor ao vivo para "${sport}".`);
    const runs = new PgJobRunStore(ctx.db);
    const runId = await runs.start('live:reconcile');
    const jobId = `job-run:${runId}`;
    const cursors = new PgCursorStore(ctx.db);
    const store = new PgLiveStore(ctx.db, {
      publish: !values['sem-publicar'],
      onFinished: async (changes) => {
        if (values['sem-tabelas']) return;
        const seasonIds = [...new Set(changes.flatMap((c) => (c.seasonId ? [c.seasonId] : [])))];
        if (seasonIds.length) await recomputeStandings(ctx.db, { seasonIds, rulesDir });
      },
    });
    const provider = new ApiSportsProvider(ctx.client, { priority: 'LIVE', jobId });
    try {
      const r = await reconcileLive(provider, store, {
        sport,
        now,
        lookbackHours,
        max,
        jobId,
        onDetailFetched: async (providerEventId, at) => {
          await cursors.complete(
            [{ sport, endpoint: '/fixtures', key: `id=${providerEventId}` }],
            { source: 'live-reconcile', jobRunId: runId, fetchedAt: at.toISOString() },
            new Date(),
          );
        },
      });
      for (const c of r.changes.filter((x) => x.finished || x.kinds.includes('status')))
        log.info(
          {
            event_id: c.eventId,
            provider_event_id: c.providerEventId,
            status: c.statusDetail,
            score: c.score,
          },
          c.finished ? 'jogo encerrado pela reconciliação' : 'status corrigido pela reconciliação',
        );
      const stats = {
        pending: r.pending,
        checked: r.checked.length,
        changed: r.changes.length,
        finished: r.finished.length,
        published: r.published,
        errors: r.errors,
      };
      await runs.finish(runId, { status: 'ok', callsSpent: r.calls, stats });
      log.info({ ...stats, calls: r.calls }, 'reconciliação do ao vivo concluída');
    } catch (err) {
      await runs.finish(runId, { status: 'error', callsSpent: 0, stats: {}, error: String(err) });
      throw err;
    }
  } finally {
    await closeDb(ctx.db);
  }
});
