/**
 * Fechamento pós-jogo (regras em postgame/plan.ts): busca de novo a lista do dia dos esportes com jogo
 * pendente, no modo e no intervalo de cada esporte (painel, POSTGAME_*), e grava placar e status no core.
 * O scheduler roda a cada minuto; sem nada na vez, sai sem chamar nem registrar execução.
 *   pnpm --filter @galaxie/ingestor postgame:close --plan   # o que está pendente e o que seria buscado
 *   pnpm --filter @galaxie/ingestor postgame:close
 * Opções: --forcar (busca todas as datas pendentes agora, ignorando o intervalo; respeita o teto do dia)
 *
 * Custo quando não há nada na vez (a maior parte dos minutos): uma consulta dos pendentes e uma leitura de cursores
 * (dezenas de ms de banco). O resto era o Node carregando o que só serve para buscar: o logger com a observabilidade
 * (~650 ms), a normalização (~730 ms) e o contexto do fornecedor. Esses três só são carregados depois de saber que há
 * lista na vez; o runner vem junto com o job-cli e é leve (docs/runbooks/alertas-e-monitoramento.md › CPU dos jobs por
 * minuto).
 */
import { closeDb, createDb } from '@galaxie/db';
import { dbProfileFromEnv } from '../db-profile.js';
import { PgCursorStore } from '../jobs/runtime/cursor-store.js';
import { plannedRequest } from '../jobs/runtime/runner.js';
import {
  dueLists,
  holdSport,
  listCursor,
  listEndpoint,
  maxCallsPerDay,
  pendingDays,
  postgameSports,
  recordCalls,
  recordTries,
  type DueList,
} from '../postgame/plan.js';
import { parseCli, planOrRun, runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseCli({});
  const sports = postgameSports();
  if (!sports.length) return;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  // o mesmo perfil de tempos do contexto, sem carregar o contexto
  const profile = dbProfileFromEnv();
  const db = createDb(url, profile ? { profile } : {});
  try {
    const now = new Date();
    const cursors = new PgCursorStore(db);
    const pending = await pendingDays(db, sports, now, process.env.LIVE_MIN_PRIORITY?.trim() || 'medium');
    const forced = values.forcar ?? false;
    const intervals = forced ? sports.map((s) => ({ ...s, intervalMin: 0 })) : sports;
    const { due, capped, held, exhausted } = await dueLists(
      cursors,
      intervals,
      pending,
      now,
      maxCallsPerDay(),
    );
    if (capped.length) {
      const { logger } = await import('../logger.js');
      for (const sport of capped)
        logger.warn(
          { sport, max: maxCallsPerDay() },
          'fechamento pós-jogo: teto de chamadas do dia atingido',
        );
    }
    if (values.plan) {
      console.log(
        `Pendentes: ${pending.map((p) => `${p.sport} ${p.date} (${p.pending})`).join(', ') || 'nenhum'}`,
      );
      console.log(`Na vez: ${due.map((d) => `${d.sport} ${d.date}`).join(', ') || 'nenhuma lista'}`);
      if (capped.length) console.log(`No teto do dia: ${capped.join(', ')}`);
      if (held.length) console.log(`Em espera (cota negada): ${held.join(', ')}`);
      if (exhausted.length)
        console.log(
          `Sem mais tentativas (agenda D-1): ${exhausted.map((d) => `${d.sport} ${d.date}`).join(', ')}`,
        );
      return;
    }
    if (!due.length) return;
    // há lista na vez: só agora o contexto do fornecedor (cliente, Governor), o logger e a normalização
    const [{ jobContextFromEnv }, { logger }, { normalizeAfterFetch }] = await Promise.all([
      import('../context.js'),
      import('../logger.js'),
      import('../normalize/after-fetch.js'),
    ]);
    const ctx = jobContextFromEnv(process.env, { db });
    const normalize = normalizeAfterFetch(ctx.db, {
      // os outros esportes vão ao core já aqui, sem esperar o normalize-sports de hora em hora
      otherSports: true,
      onError: (err, endpoint, params) =>
        logger.warn({ err, endpoint, params }, 'fechamento pós-jogo: falha ao normalizar a lista'),
    });
    // uma execução por esporte: a cota de um (o runner para na primeira negação) não segura os outros
    const bySport = new Map<string, DueList[]>();
    for (const d of due) bySport.set(d.sport, [...(bySport.get(d.sport) ?? []), d]);
    for (const [sport, lists] of bySport) {
      const spec = {
        job: 'postgame:close',
        priority: 'ADHOC' as const,
        phases: [
          {
            name: `listas do dia (${sport})`,
            build: async () =>
              lists.map((d) =>
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
      // o teto e as tentativas contam só o que saiu para o fornecedor (cota negada, rate limit e offline não gastam)
      const calls = new Map<string, number>();
      const fetched: DueList[] = [];
      const report = await planOrRun(
        ctx,
        spec,
        { ...values, 'sem-live': false },
        {
          afterFetch: async (envelope, request) => {
            if (request.source === 'network') {
              calls.set(request.sport, (calls.get(request.sport) ?? 0) + 1);
              const d = lists.find((l) => l.date === request.params.date);
              if (d) fetched.push(d);
            }
            await normalize.afterFetch(envelope, request);
          },
        },
      );
      await recordCalls(ctx.cursors, calls, now);
      await recordTries(ctx.cursors, fetched, now);
      if (report?.stoppedBy === 'quota') {
        await holdSport(ctx.cursors, sport, now);
        logger.warn(
          { sport, reason: report.reason },
          'fechamento pós-jogo: cota negada; esporte em espera por 1 h',
        );
      }
    }
    const n = normalize.report();
    console.log(
      `Fechamento pós-jogo: ${due.length} lista(s) (${due.map((d) => `${d.sport} ${d.date}`).join(', ')}) · ${n.stats.events.updated} jogo(s) atualizados.`,
    );
  } finally {
    await closeDb(db);
  }
});
