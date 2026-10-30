/**
 * Fechamento pós-jogo (regras em postgame/plan.ts): busca de novo a lista do dia dos esportes com jogo
 * pendente, no modo e no intervalo de cada esporte (painel, POSTGAME_*), e grava placar e status no core.
 * O scheduler roda a cada minuto; sem nada na vez, sai sem chamar nem registrar execução.
 *   pnpm --filter @galaxie/ingestor postgame:close --plan   # o que está pendente e o que seria buscado
 *   pnpm --filter @galaxie/ingestor postgame:close
 * Opções: --forcar (busca todas as datas pendentes agora, ignorando o intervalo; respeita o teto do dia)
 */
import { closeDb } from '@galaxie/db';
import { jobContextFromEnv } from '../context.js';
import { plannedRequest, type JobSpec } from '../jobs/runtime/runner.js';
import { logger } from '../logger.js';
import { normalizeAfterFetch } from '../normalize/after-fetch.js';
import {
  dueLists,
  listCursor,
  listEndpoint,
  maxCallsPerDay,
  pendingDays,
  postgameSports,
  recordCalls,
} from '../postgame/plan.js';
import { parseCli, planOrRun, runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseCli({});
  const sports = postgameSports();
  if (!sports.length) return;
  const ctx = jobContextFromEnv();
  try {
    const now = ctx.now();
    const pending = await pendingDays(ctx.db, sports, now, process.env.LIVE_MIN_PRIORITY?.trim() || 'medium');
    const forced = values.forcar ?? false;
    const intervals = forced ? sports.map((s) => ({ ...s, intervalMin: 0 })) : sports;
    const { due, capped } = await dueLists(ctx.cursors, intervals, pending, now, maxCallsPerDay());
    for (const sport of capped)
      logger.warn({ sport, max: maxCallsPerDay() }, 'fechamento pós-jogo: teto de chamadas do dia atingido');
    if (values.plan) {
      console.log(
        `Pendentes: ${pending.map((p) => `${p.sport} ${p.date} (${p.pending})`).join(', ') || 'nenhum'}`,
      );
      console.log(`Na vez: ${due.map((d) => `${d.sport} ${d.date}`).join(', ') || 'nenhuma lista'}`);
      if (capped.length) console.log(`No teto do dia: ${capped.join(', ')}`);
      return;
    }
    if (!due.length) return;
    const spec: JobSpec = {
      job: 'postgame:close',
      priority: 'ADHOC',
      phases: [
        {
          name: 'listas do dia',
          build: async () =>
            due.map((d) =>
              plannedRequest(
                'pos-jogo',
                d.sport,
                listEndpoint(d.sport),
                { date: d.date },
                // o cursor da data diz quando foi a última busca; o raw da agenda nunca vale como resposta
                { cursors: [listCursor(d.sport, d.date)], staleBefore: now, maxAgeMs: 30_000 },
              ),
            ),
        },
      ],
    };
    const normalize = normalizeAfterFetch(ctx.db, {
      // os outros esportes vão ao core já aqui, sem esperar o normalize-sports de hora em hora
      otherSports: true,
      onError: (err, endpoint, params) =>
        logger.warn({ err, endpoint, params }, 'fechamento pós-jogo: falha ao normalizar a lista'),
    });
    // o teto conta só o que saiu para o fornecedor (cota negada, rate limit ou offline não gastam o dia)
    const calls = new Map<string, number>();
    const report = await planOrRun(
      ctx,
      spec,
      { ...values, 'sem-live': false },
      {
        afterFetch: async (envelope, request) => {
          if (request.source === 'network') calls.set(request.sport, (calls.get(request.sport) ?? 0) + 1);
          await normalize.afterFetch(envelope, request);
        },
      },
    );
    await recordCalls(ctx.cursors, calls, now);
    if (report) {
      const n = normalize.report();
      console.log(
        `Fechamento pós-jogo: ${due.length} lista(s) (${due.map((d) => `${d.sport} ${d.date}`).join(', ')}) · ${n.stats.events.updated} jogo(s) atualizados.`,
      );
    }
  } finally {
    await closeDb(ctx.db);
  }
});
