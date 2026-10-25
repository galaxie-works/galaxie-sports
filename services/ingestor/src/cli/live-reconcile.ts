/**
 * Reconciliação do ao vivo: confirma na fonte os jogos que o core ainda dá como em andamento, ou que o
 * relógio encerrou sem placar, e grava status, placar e encerramento. Rede de segurança do scheduler e
 * "botão de pânico" do painel de Operação — não depende do processo do ao vivo (regras em live/reconcile.ts).
 * Sem --forcar, só confere o que parece errado:
 * - jogos acompanhados pelo ao vivo, já vistos depois do apito, sem observação válida há N minutos (ou 2×
 *   o intervalo do plano do ao vivo; nada com o orçamento LIVE esgotado): detalhe `fixtures?id=` (LIVE);
 * - jogos do catálogo encerrados pelo relógio sem placar da fonte: uma agenda `fixtures?date=` (ADHOC)
 *   confirma todos os devidos da data, no máximo uma por data a cada 60 min e só dentro da fatia ADHOC do
 *   dia (nunca pega folga emprestada; o que passar fica para o sync D-1), com até 3 tentativas por jogo.
 * Os que o poller está atualizando não gastam cota de novo.
 * O painel ("rodar agora") e o `scheduler --run` rodam com --forcar (detalhe de todo jogo em andamento).
 *   pnpm --filter @galaxie/ingestor live:reconcile --plan     # quais jogos seriam conferidos (nada é chamado)
 *   pnpm --filter @galaxie/ingestor live:reconcile            # confere e corrige os parados
 *   pnpm --filter @galaxie/ingestor live:reconcile --forcar   # confere todos os em andamento
 * Opções: --esporte football · --horas 6 (jogos que começaram até N horas atrás) · --max 60 (chamadas)
 *         · --parado-min 30 · --prioridade-min high|medium|low (padrão: LIVE_MIN_PRIORITY ou medium)
 *         · --sem-publicar · --sem-tabelas
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { ApiSportsProvider } from '@galaxie/providers';
import { contextFromEnv } from '../context.js';
import { cursorId, PgCursorStore } from '../jobs/runtime/cursor-store.js';
import { PgJobRunStore } from '../jobs/runtime/job-run-store.js';
import {
  adhocAllowance,
  candidatesLookbackHours,
  DEFAULT_STALE_MINUTES,
  dueUnconfirmed,
  nextListAt,
  RECONCILE_CURSOR_ENDPOINT,
  inPlayCandidates,
  reconcileLive,
  reconcileReason,
  type ReconcileTargetOptions,
} from '../live/reconcile.js';
import type { LiveSchedulerOptions } from '../live/schedule.js';
import { loadLiveState, pruneReconcileCursors } from '../live/state.js';
import { PgLiveStore } from '../live/store.js';
import { logger, report } from '../logger.js';
import { recomputeStandings } from '../standings/recompute.js';
import { runCli } from './job-cli.js';

const rulesDir = resolve('../../config/rules');
const LIVE_STATE_MAX_AGE_MS = 15 * 60_000;
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
      forcar: { type: 'boolean', default: false },
      'parado-min': { type: 'string', default: String(DEFAULT_STALE_MINUTES) },
      'prioridade-min': { type: 'string' },
      'sem-publicar': { type: 'boolean', default: false },
      'sem-tabelas': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const sport = values.esporte;
  const lookbackHours = positive(values.horas, '--horas');
  const max = positive(values.max, '--max');
  const minPriority = (values['prioridade-min'] ||
    process.env.LIVE_MIN_PRIORITY?.trim() ||
    'medium') as LiveSchedulerOptions['minPriority'];
  if (!['high', 'medium', 'low'].includes(minPriority))
    throw new Error('--prioridade-min deve ser high, medium ou low.');
  const ctx = contextFromEnv();
  const now = new Date();

  try {
    // plano do ao vivo (gravado pelo live-run a cada passo): intervalo atual e orçamento esgotado. Estado de
    // outro dia ou parado há mais de 15 min (o ao vivo caiu ou saiu ocioso) não vale
    const live = await loadLiveState(ctx.db, sport);
    const today =
      live?.day === now.toISOString().slice(0, 10) &&
      now.getTime() - Date.parse(live.updatedAt) <= LIVE_STATE_MAX_AGE_MS
        ? live
        : null;
    const intervalS = Math.max(today?.intervalSeconds ?? 0, today?.baseIntervalSeconds ?? 0);
    const triage: ReconcileTargetOptions = {
      lookbackHours,
      force: values.forcar,
      staleMinutes: positive(values['parado-min'], '--parado-min'),
      minPriority,
      planIntervalMs: intervalS > 0 ? intervalS * 1000 : null,
      liveBudgetExhausted: !!today && today.included > 0 && today.ticksLeft <= 0,
    };
    if (values.plan) {
      const store = new PgLiveStore(ctx.db, { publish: false });
      const candidates = await store.candidates(
        sport,
        'api-sports',
        new Date(now.getTime() - candidatesLookbackHours(lookbackHours) * 3_600_000),
        now,
      );
      const inPlay = inPlayCandidates(candidates, now, lookbackHours);
      // encerrado pelo relógio só "a conferir" com tentativa devida (esgotado ou espaçando, não) e, se a
      // data já teve lote há menos de 1 h, mostra quando sai o próximo
      const planCursors = new PgCursorStore(ctx.db);
      const unconfirmed = inPlay.filter((c) => reconcileReason(c, now, triage) === 'unconfirmed');
      const due = new Set(await dueUnconfirmed(planCursors, sport, unconfirmed, now));
      const dateOf = (c: { startsAt: Date }) => c.startsAt.toISOString().slice(0, 10);
      const nextList = await nextListAt(planCursors, sport, [...new Set([...due].map(dateOf))], now);
      const rows = inPlay.map((c) => {
        const reason = reconcileReason(c, now, triage);
        if (reason !== 'unconfirmed') return { c, motivo: reason, espera: null };
        if (!due.has(c)) return { c, motivo: null, espera: 'não (tentativas esgotadas ou espaçando)' };
        const at = nextList.get(dateOf(c));
        return at
          ? { c, motivo: null, espera: `${reason}, no lote das ${at.toISOString().slice(11, 16)}` }
          : { c, motivo: reason, espera: null };
      });
      const pending = rows.filter((r) => r.motivo).length;
      report(
        `Em andamento no core (${inPlay.length}; ${pending} a conferir, até ${max})`,
        rows.map(({ c, motivo, espera }) => ({
          jogo: c.label ?? c.eventId,
          status: c.statusDetail ?? c.status,
          apito_utc: c.startsAt.toISOString().slice(11, 16),
          ultima_obs_utc: c.lastValidAt?.toISOString().slice(11, 16) ?? '—',
          prioridade: c.livePriority,
          conferir: motivo ?? espera ?? 'não',
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
    // fatia ADHOC do dia: as agendas dos encerrados pelo relógio nunca pegam folga emprestada
    const adhocAvailable = adhocAllowance(await ctx.governor.usage(sport));
    try {
      const r = await reconcileLive(provider, store, {
        sport,
        now,
        ...triage,
        max,
        jobId,
        cursors,
        adhocAvailable,
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
      // aviso de falta de cota: uma vez por data e por dia (sem repetir a cada 10 min)
      const day = now.toISOString().slice(0, 10);
      const warnRefs = r.listSkipped.map((skip) => ({
        sport,
        endpoint: RECONCILE_CURSOR_ENDPOINT,
        key: `aviso=${skip.date}@${day}`,
      }));
      const warned = await cursors.load(warnRefs);
      for (const [i, skip] of r.listSkipped.entries()) {
        if (warned.get(cursorId(warnRefs[i]!))?.completedAt) continue;
        log.warn(
          { date: skip.date, reason: skip.reason, games: skip.games, adhoc_available: adhocAvailable },
          'encerrados pelo relógio sem conferência por falta de cota; ficam para o sync D-1',
        );
        await cursors.complete([warnRefs[i]!], { reason: skip.reason }, now);
      }
      // cursores da reconciliação só servem dentro da janela de horas: apaga os de mais de 2 dias
      await pruneReconcileCursors(ctx.db, new Date(now.getTime() - 2 * 86_400_000));
      const stats = {
        forced: values.forcar,
        inPlay: r.inPlay,
        pending: r.pending,
        checked: r.checked.length,
        listed: r.listed,
        listSkipped: r.listSkipped.length,
        confirmedByList: r.confirmedByList.length,
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
