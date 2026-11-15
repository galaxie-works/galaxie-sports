/**
 * Ao vivo (issues #54 e #55): Live Scheduler + Live Poller num processo de longa duração.
 *   pnpm --filter @galaxie/ingestor live:run --plan               # plano do dia: janelas, orçamento, intervalo (nada é chamado nem gravado)
 *   pnpm --filter @galaxie/ingestor live:run --plan --dia amanha  # pré-visualiza amanhã
 *   pnpm --filter @galaxie/ingestor live:run                      # roda enquanto houver janela; sai ocioso (o scheduler reinicia)
 *   pnpm --filter @galaxie/ingestor live:run --continuo           # fica no ar indefinidamente
 * Opções: --esporte football · --destaque off|auto|on (detalhe do jogo principal a cada tick) · --intervalo-max-min 15
 *         · --proteger-daily N · --ocioso-min 15 · --prioridade-min high|medium|low · --sem-confirmar-final
 *         · --sem-publicar · --sem-tabelas
 * Variáveis: LIVE_FEATURED, LIVE_MAX_INTERVAL_MINUTES, LIVE_IDLE_EXIT_MINUTES, LIVE_PROTECT_DAILY, LIVE_MIN_PRIORITY e
 * MODULES_FOOTBALL (tiers do módulo `live`, Ajustes → Dados → Módulos por esporte).
 * O painel de Operação sobrescreve essas variáveis pelo banco; o processo relê a cada minuto, sem reiniciar.
 * SIGTERM/SIGINT encerram com elegância (termina o tick em andamento, registra ops.job_run, fecha o banco).
 * LIVE_LEADER=on (padrão off) liga líder e reserva (live/leader.ts): fica no ar como --continuo, só a cópia com a
 * trava `live:leader` chama a api-sports e a outra tenta a trava a cada LIVE_LEADER_RETRY_MS (padrão 1000).
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb, jobLockContender, readRuntimeOverrides } from '@galaxie/db';
import { applyOverrides, moduleConfig, runtimeBaseEnv } from '@galaxie/runtime-config';
import { settingsSecretBox } from '@galaxie/runtime-config/sealed';
import { ApiSportsProvider } from '@galaxie/providers';
import { contextFromEnv } from '../context.js';
import { PgCursorStore } from '../jobs/runtime/cursor-store.js';
import { PgJobRunStore } from '../jobs/runtime/job-run-store.js';
import { PgLiveHandoffStore } from '../live/handoff.js';
import { claimLiveLeaderEpoch } from '../live/leader-epoch.js';
import {
  LIVE_LEADER_LOCK,
  liveLeaderSessionName,
  liveLeaderSettings,
  runLiveLeadership,
} from '../live/leader.js';
import { LiveRunner, type LiveRunSummary } from '../live/runner.js';
import {
  decideTick,
  DEFAULT_LIVE_OPTIONS,
  planLiveDay,
  utcDayBounds,
  windowEnd,
  type LiveSchedulerOptions,
} from '../live/schedule.js';
import { liveStateFromPlan, saveLiveState } from '../live/state.js';
import { PgLiveStore } from '../live/store.js';
import { PgLiveTickStore } from '../live/tick-record.js';
import type { LiveDayPlan } from '../live/types.js';
import { logger, report } from '../logger.js';
import { needsAttention, recomputeStandings } from '../standings/recompute.js';
import { runCli } from './job-cli.js';

const rulesDir = resolve('../../config/rules');
/** Env do contêiner sem as sobrescritas que o scheduler aplicou na partida. */
const baseEnv = runtimeBaseEnv(process.env);
const log = logger.child({ component: 'live' });

function num(value: string | undefined, flag: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`${flag} precisa ser um número ≥ 0 (recebido: ${value}).`);
  return n;
}

const hhmm = (d: Date) => d.toISOString().slice(11, 16);
const fmtInterval = (ms: number) =>
  !Number.isFinite(ms) ? '—' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60_000).toFixed(1)} min`;

function printPlan(plan: LiveDayPlan): void {
  const b = plan.budget;
  console.log(
    `Plano ao vivo de ${plan.sport} — dia de cota ${plan.day} (UTC), a partir de ${plan.generatedAt.toISOString()}`,
  );
  if (plan.included.length) {
    report(
      'Jogos acompanhados (ordem de prioridade)',
      plan.included.map((m) => ({
        ordem: m.rank + 1,
        jogo: m.candidate.label ?? m.candidate.eventId,
        liga: m.candidate.providerCompetitionId,
        prioridade: m.candidate.livePriority,
        tier: m.candidate.tier,
        fase: m.candidate.stageKind,
        classico: m.candidate.derby ? 'sim' : '',
        status: m.candidate.statusDetail ?? m.candidate.status,
        apito_utc: hhmm(m.candidate.startsAt),
        janela_utc: `${hhmm(m.window.start)}–${hhmm(windowEnd(m.window))}${m.window.contingentEnd ? ' (prorr.)' : ''}`,
      })),
    );
    report(
      'Janelas unidas (UTC)',
      plan.segments.map((s) => ({
        inicio: s.start.toISOString().slice(0, 16),
        fim: s.end.toISOString().slice(0, 16),
        minutos: Math.round((s.end.getTime() - s.start.getTime()) / 60_000),
        ligas: s.leagues.join('-'),
        jogos: s.eventIds.length,
      })),
    );
  } else {
    console.log('Nenhum jogo relevante no restante do dia: LIVE = 0 (a folga vai para o BOOTSTRAP).');
  }
  const budgetOut = plan.excluded.filter((e) => e.reason === 'budget');
  if (budgetOut.length)
    console.log(
      `Fora por orçamento (${budgetOut.length}): ${budgetOut.map((e) => e.label ?? e.eventId).join(' · ')}`,
    );
  console.log(
    `Orçamento: limite ${b.dailyLimit}${b.liveUsesReserve ? ` (a reserva de ${b.reserve} é do ao vivo)` : ` − reserva ${b.reserve}`} · ` +
      `DAILY protegido ${b.protectedDaily} · ` +
      `LIVE ${b.liveTotal} (já usado ${b.liveUsed}; ${b.finalizeReserve} para confirmar placares finais) · ` +
      `${b.ticksLeft} tick(s) de ${b.tickCost} chamada(s)${plan.featured ? ' (com detalhe do jogo em destaque)' : ''}`,
  );
  console.log(
    `Minutos de janela restantes: ${plan.windowMinutes} (ponderados: ${plan.weightedMinutes}) → ` +
      `intervalo médio ${fmtInterval(plan.nominalIntervalMs)} · minuto normal ${fmtInterval(plan.baseIntervalMs)} · ` +
      `reta final/prorrogação ${fmtInterval(Math.max(15_000, plan.baseIntervalMs / 2))}`,
  );
}

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      plan: { type: 'boolean', default: false },
      dia: { type: 'string', default: 'hoje' },
      esporte: { type: 'string', default: 'football' },
      continuo: { type: 'boolean', default: false },
      destaque: { type: 'string' },
      'intervalo-max-min': { type: 'string' },
      'proteger-daily': { type: 'string' },
      'ocioso-min': { type: 'string' },
      'prioridade-min': { type: 'string' },
      'sem-confirmar-final': { type: 'boolean', default: false },
      'sem-publicar': { type: 'boolean', default: false },
      'sem-tabelas': { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (!['hoje', 'amanha'].includes(values.dia)) throw new Error('--dia deve ser hoje ou amanha.');
  const leader = liveLeaderSettings();
  // as opções da linha de comando vencem; o resto vem do env (que o scheduler já entrega com o painel)
  const settingsFrom = (env: NodeJS.ProcessEnv) => {
    const featured = values.destaque ?? env.LIVE_FEATURED?.trim() ?? 'off';
    if (!['off', 'auto', 'on'].includes(featured)) throw new Error('--destaque deve ser off, auto ou on.');
    const maxIntervalMin = num(
      values['intervalo-max-min'] ?? env.LIVE_MAX_INTERVAL_MINUTES,
      '--intervalo-max-min',
    );
    const idleMin = num(values['ocioso-min'] ?? env.LIVE_IDLE_EXIT_MINUTES, '--ocioso-min');
    const protectDaily = num(values['proteger-daily'] ?? env.LIVE_PROTECT_DAILY, '--proteger-daily');
    const minPriority = (values['prioridade-min'] || env.LIVE_MIN_PRIORITY?.trim() || undefined) as
      LiveSchedulerOptions['minPriority'] | undefined;
    if (minPriority && !['high', 'medium', 'low'].includes(minPriority))
      throw new Error('--prioridade-min deve ser high, medium ou low.');
    // tiers do módulo `live` do painel (MODULES_FOOTBALL); valor inválido vale o padrão (todos), não derruba o ao vivo
    const tiers = moduleConfig((key) => env[key])
      .api('football')
      .tiersOn('live');
    return {
      tiers,
      featured: featured as LiveSchedulerOptions['featured'],
      maxIntervalMs:
        maxIntervalMin !== undefined ? maxIntervalMin * 60_000 : DEFAULT_LIVE_OPTIONS.maxIntervalMs,
      protectDaily,
      // líder e reserva não saem ociosas: a líder dorme com a trava na mão (a reserva assumiria só para sair)
      idleExitMs: values.continuo || leader.enabled ? null : (idleMin ?? 15) * 60_000,
      ...(minPriority ? { minPriority } : {}),
    };
  };
  const initial = settingsFrom(process.env);
  const { featured } = initial;
  const options: Partial<LiveSchedulerOptions> = {
    featured,
    tiers: initial.tiers,
    finalize: !values['sem-confirmar-final'],
    maxIntervalMs: initial.maxIntervalMs,
    ...(initial.protectDaily !== undefined ? { protectDaily: initial.protectDaily } : {}),
    ...(initial.minPriority ? { minPriority: initial.minPriority } : {}),
  };
  const sport = values.esporte;
  // tempos do banco do perfil `live` com a eleição ou no serviço do ao vivo (SCHEDULER_PROFILE=live); sem os dois,
  // os dos jobs
  const ctx = contextFromEnv(process.env, leader.enabled ? { dbProfile: 'live' } : {});

  try {
    if (values.plan) {
      // somente leitura: candidatos do core e uso do ledger; nada é chamado nem gravado
      const today = new Date();
      const now = values.dia === 'amanha' ? utcDayBounds(today).end : today;
      const { start, end, day } = utcDayBounds(now);
      const store = new PgLiveStore(ctx.db, { publish: false });
      const candidates = await store.candidates(
        sport,
        'api-sports',
        new Date(start.getTime() - 6 * 3_600_000),
        new Date(end.getTime() + 86_400_000),
      );
      const usage = await ctx.governor.usage(sport, day);
      const plan = planLiveDay({ sport, now, candidates, usage, options });
      printPlan(plan);
      const next = decideTick(plan, now, null, options);
      console.log(
        next.kind === 'tick'
          ? `Agora: tick em ${next.leagues.join('-')} (peso ${next.weight}).`
          : next.kind === 'wait'
            ? `Agora: esperar até ${next.until.toISOString()} (${next.reason}).`
            : 'Agora: nada a fazer no restante do dia.',
      );
      return;
    }

    if (ctx.offline)
      throw new Error('Sem APISPORTS_KEY o ao vivo não tem fonte (use --plan para ver o plano).');
    if (!new ApiSportsProvider(ctx.client).supports(sport))
      throw new Error(`Ainda não há provedor ao vivo para "${sport}" (só o plano: --plan).`);
    const runs = new PgJobRunStore(ctx.db);
    const cursors = new PgCursorStore(ctx.db);

    /** Uma execução em ops.job_run; com líder e reserva, um mandato de líder (a reserva não registra nada). */
    const runTerm = async (
      signal: AbortSignal,
      fence?: AbortSignal,
      epoch?: number,
    ): Promise<LiveRunSummary> => {
      // só a dona da trava abre execução: se há outra aberta, a líder anterior morreu sem registrar o fim
      if (leader.enabled)
        await runs.closeInterrupted('live:run', 'interrompido: a líder morreu sem encerrar');
      const runId = await runs.start('live:run');
      const jobId = `job-run:${runId}`;
      const leaderEpoch = epoch === undefined ? undefined : { sport, epoch };
      const handoff = leader.enabled ? new PgLiveHandoffStore(ctx.db, 'api-sports', leaderEpoch) : undefined;
      // a sucessora pode já ter marcado a execução como interrompida: esse resultado fica
      const finishRun = async (result: Parameters<typeof runs.finish>[1]) => {
        if (!leader.enabled) return runs.finish(runId, result);
        if (!(await runs.finishIfRunning(runId, result)))
          log.warn(
            { run_id: runId, epoch },
            'execução já fechada pela líder seguinte; mantendo o resultado dela',
          );
      };
      const store = new PgLiveStore(ctx.db, {
        publish: !values['sem-publicar'],
        leaderEpoch,
        onFinished: async (changes) => {
          if (values['sem-tabelas']) return;
          const seasonIds = [...new Set(changes.flatMap((c) => (c.seasonId ? [c.seasonId] : [])))];
          if (!seasonIds.length) return;
          const tables = await recomputeStandings(ctx.db, { seasonIds, rulesDir });
          for (const t of tables) {
            const fields = {
              season_id: t.seasonId,
              competition: t.competition,
              outcome: t.outcome,
              rows: t.rows,
              ...(needsAttention(t)
                ? {
                    detail: t.detail,
                    skipped: t.skipped,
                    unclassified: t.unclassified,
                    unmatched_rounds: t.unmatchedRounds,
                  }
                : {}),
            };
            if (needsAttention(t)) log.warn(fields, 'tabela após jogo encerrado pede atenção');
            else log.info(fields, 'tabela recalculada após jogo encerrado');
          }
        },
      });
      const provider = new ApiSportsProvider(ctx.client, { priority: 'LIVE', jobId });

      let lastStateKey = '';
      let lastStateAt = 0;
      const latest: { plan?: LiveDayPlan } = {};
      const runner = new LiveRunner({
        sport,
        provider,
        store,
        governor: ctx.governor,
        log,
        jobId,
        handoff,
        // ritmo para o /metrics do scheduler (live_last_tick_age_seconds e afins), com a mesma cerca de época do bastão
        tickRecord: new PgLiveTickStore(ctx.db, 'api-sports', leaderEpoch),
        instance: leader.instance,
        options: { ...options, idleExitMs: initial.idleExitMs },
        // painel de Operação: relê LIVE_* do banco a cada minuto (banco > env do contêiner > padrão)
        refresh: {
          everyMs: 60_000,
          load: async () => {
            const { env } = applyOverrides(baseEnv, await readRuntimeOverrides(ctx.db), {
              secrets: settingsSecretBox(baseEnv),
              services: ['live'],
            });
            return settingsFrom(env);
          },
        },
        hooks: {
          onPlan: async (plan) => {
            latest.plan = plan;
            const state = liveStateFromPlan(plan, new Date());
            const key = JSON.stringify({ ...state, updatedAt: null });
            if (key === lastStateKey && Date.now() - lastStateAt < 60_000) return;
            lastStateKey = key;
            lastStateAt = Date.now();
            await saveLiveState(ctx.db, state).catch((err: unknown) =>
              log.warn({ err }, 'não foi possível gravar o estado do ao vivo'),
            );
          },
          onDetailFetched: async (providerEventId, at) => {
            // o detalhe do encerrado já veio pelo ao vivo: o sync diário não busca de novo
            await cursors.complete(
              [{ sport, endpoint: '/fixtures', key: `id=${providerEventId}` }],
              { source: 'live', jobRunId: runId, fetchedAt: at.toISOString() },
              new Date(),
            );
          },
          onTick: (tick) => {
            for (const c of tick.changes.filter((x) => x.goal || x.finished))
              log.info(
                {
                  event_id: c.eventId,
                  provider_event_id: c.providerEventId,
                  score: c.score,
                  status: c.statusDetail,
                  goal: c.goal,
                  finished: c.finished,
                },
                c.finished ? 'jogo encerrado' : 'gol',
              );
          },
        },
      });
      log.info({ sport, featured, run_id: runId }, 'ao vivo iniciado');
      try {
        const summary = await runner.run(signal, fence);
        const stats = {
          stoppedBy: summary.stoppedBy,
          ticks: summary.ticks,
          errors: summary.errors,
          changes: summary.changes,
          published: summary.published,
          goals: summary.goals,
          finalized: summary.finalized,
          days: [...summary.plans.keys()],
          ...(epoch === undefined ? {} : { leader_epoch: epoch }),
        };
        const lost = summary.stoppedBy === 'lost';
        // passagem de bastão: o estado mais recente fica publicado antes de soltar a trava (quem perdeu a trava
        // não escreve: a outra cópia já pode estar gravando)
        if (leader.enabled && !lost && latest.plan)
          await saveLiveState(ctx.db, liveStateFromPlan(latest.plan, new Date())).catch((err: unknown) =>
            log.warn({ err }, 'não foi possível gravar o estado do ao vivo'),
          );
        // a trava costuma cair junto com o banco: a execução pode ficar sem fechar, e isso não derruba a cópia
        await finishRun({ status: 'ok', callsSpent: summary.calls, stats }).catch((err: unknown) => {
          if (!lost) throw err;
          log.warn({ err, run_id: runId }, 'não foi possível fechar a execução depois de perder a trava');
        });
        log.info({ ...stats, calls: summary.calls }, 'ao vivo encerrado');
        return summary;
      } catch (err) {
        await finishRun({ status: 'error', callsSpent: 0, stats: {}, error: String(err) });
        throw err;
      }
    };

    const controller = new AbortController();
    const stop = (signal: string) => {
      if (controller.signal.aborted) return;
      log.info({ signal }, 'encerrando o ao vivo depois do tick em andamento');
      controller.abort();
    };
    process.once('SIGTERM', () => stop('SIGTERM'));
    process.once('SIGINT', () => stop('SIGINT'));

    if (!leader.enabled) {
      await runTerm(controller.signal);
      return;
    }
    const lock = jobLockContender(process.env.DATABASE_URL!, LIVE_LEADER_LOCK, {
      applicationName: liveLeaderSessionName(leader.instance),
    });
    try {
      await runLiveLeadership(
        {
          lock,
          instance: leader.instance,
          retryMs: leader.retryMs,
          log,
          claimEpoch: () => claimLiveLeaderEpoch(ctx.db, sport, leader.instance),
          term: runTerm,
        },
        controller.signal,
      );
    } finally {
      await lock.close();
    }
  } finally {
    await closeDb(ctx.db);
  }
});
