/**
 * Scheduler em modo serviço: agenda os jobs do perfil e, a cada `refreshMs` (padrão 30 s), relê a
 * configuração do painel (ops.runtime_setting). Precedência banco > env > padrão: as sobrescritas
 * válidas entram no env de cada job (cada execução é um processo novo, então os jobs leem os valores
 * novos no começo), as agendas mudadas são reprogramadas sem reiniciar o contêiner e os pedidos de
 * "rodar agora" (ops.job_request) são executados. O env do contêiner é relatado em ops.runtime_env
 * (segredos só como configurado/não configurado), que também serve de sinal de vida para o painel.
 *
 * Job `keepAlive` (o `live-run` do perfil `live`) não tem cron: sobe com o serviço e, quando o processo sai, sobe de
 * novo depois de `keepAliveDelayMs` (dobra a cada saída rápida, até `keepAliveMaxDelayMs`).
 */
import { Cron } from 'croner';
import {
  claimJobRequests,
  finishJobRequest,
  readRuntimeOverrides,
  reportRuntimeEnv,
  saveRuntimeCheck,
  type ClaimedJobRequest,
  type Database,
} from '@galaxie/db';
import type { Logger } from '@galaxie/observability';
import { AI_CREDIT_CHECK, applyOverrides, envReport, scheduledJob } from '@galaxie/runtime-config';
import { reportAiHeartbeat, type CreditCheckResult } from './ai-credit.js';
import type { MissedSlot } from './catch-up.js';
import type { RunResult, RunTrigger } from './runner.js';
import { nextRuns, scheduleFromEnv, type ScheduledJob } from './schedule.js';
import { JobSlots } from './slots.js';

/** Quem agenda: o ingestor, os agentes de IA ou o ao vivo (serviço `live`, só os jobs da faixa do ao vivo). */
export type SchedulerProfile = 'ingestor' | 'agents' | 'live';

export interface SchedulerServiceOptions {
  profile: SchedulerProfile;
  /** Definições do perfil (agenda padrão do código). */
  jobs: readonly ScheduledJob[];
  /** Env do contêiner (o "padrão de fábrica" que o painel sobrescreve). */
  env: NodeJS.ProcessEnv;
  db?: Database | undefined;
  log: Logger;
  /** Executa um job com o env efetivo (no serviço real, `runJob` num processo filho). */
  run: (job: ScheduledJob, ctx: { trigger: RunTrigger; env: NodeJS.ProcessEnv }) => Promise<RunResult>;
  /** Releitura da configuração e da fila de pedidos. */
  refreshMs?: number;
  /** Só no perfil agents: checagem do crédito da conta de IA. */
  creditCheck?: ((env: NodeJS.ProcessEnv) => Promise<CreditCheckResult>) | undefined;
  /** Intervalo da checagem de crédito (padrão: 1 h, para o alerta AiCreditExhausted sair no mesmo dia). */
  creditEveryMs?: number;
  /**
   * Teto de jobs simultâneos fora da faixa do ao vivo (`live`); o excedente espera vaga na ordem de chegada.
   * Sem valor: sem teto.
   */
  maxJobs?: number | undefined;
  /** Atraso para religar um job `keepAlive` que saiu (padrão 1 s). */
  keepAliveDelayMs?: number;
  /** Teto do atraso quando o job `keepAlive` sai logo depois de subir (padrão 60 s). */
  keepAliveMaxDelayMs?: number;
}

/** Um job `keepAlive` que ficou no ar ao menos isto saiu "depois de trabalhar": volta com o atraso mínimo. */
const KEEPALIVE_STABLE_MS = 60_000;

interface ActiveCron {
  pattern: string;
  cron: Cron;
}

export class SchedulerService {
  private readonly log: Logger;
  private env: NodeJS.ProcessEnv;
  private current: ScheduledJob[] = [];
  private readonly crons = new Map<string, ActiveCron>();
  private readonly running = new Map<string, Promise<RunResult>>();
  private readonly background = new Set<Promise<unknown>>();
  private overridesKey = '';
  private refreshTimer: NodeJS.Timeout | undefined;
  private creditTimer: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> | null = null;
  private started = false;
  private programmed = false;
  private readonly slots: JobSlots | undefined;
  /** Jobs `keepAlive` esperando a hora de subir de novo, e o atraso da próxima saída rápida. */
  private readonly relaunch = new Map<string, NodeJS.Timeout>();
  private readonly backoff = new Map<string, number>();

  constructor(private readonly options: SchedulerServiceOptions) {
    this.log = options.log;
    this.slots = options.maxJobs ? new JobSlots(options.maxJobs) : undefined;
    this.env = { ...options.env };
    this.current = scheduleFromEnv(this.env, options.jobs);
  }

  /** Env que os jobs recebem agora (contêiner + sobrescritas válidas do painel). */
  get effectiveEnv(): Readonly<NodeJS.ProcessEnv> {
    return this.env;
  }

  /** Agenda efetiva (jobs ligados). */
  get schedule(): readonly ScheduledJob[] {
    return this.current;
  }

  /** Jobs `keepAlive` da agenda efetiva (sem cron: ficam no ar e voltam quando saem). */
  keptAlive(): string[] {
    return this.current.filter((j) => j.keepAlive).map((j) => j.name);
  }

  /** Crons programados agora, com a próxima execução. */
  activeCrons(): { job: string; cron: string; next: string | null }[] {
    return [...this.crons.entries()].map(([job, c]) => ({
      job,
      cron: c.pattern,
      next: c.cron.nextRun()?.toISOString() ?? null,
    }));
  }

  isRunning(job: string): boolean {
    return this.running.has(job);
  }

  async start(): Promise<void> {
    this.started = true;
    await this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), this.options.refreshMs ?? 30_000);
    this.refreshTimer.unref?.();
    if (this.options.creditCheck) {
      this.track(this.checkCredit());
      this.creditTimer = setInterval(
        () => this.track(this.checkCredit()),
        this.options.creditEveryMs ?? 3_600_000,
      );
      this.creditTimer.unref?.();
    }
    this.log.info(
      {
        profile: this.options.profile,
        max_jobs: this.slots?.max ?? null,
        jobs: this.activeCrons(),
        keep_alive: this.keptAlive(),
      },
      'scheduler iniciado',
    );
  }

  /** Relê a configuração do painel, reprograma a agenda, relata o env e atende os pedidos. */
  refresh(): Promise<void> {
    // uma releitura por vez: o timer não empilha se o banco estiver lento
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const { db } = this.options;
    if (db) {
      try {
        const overrides = await readRuntimeOverrides(db);
        this.applyConfig(overrides);
      } catch (err) {
        this.log.warn({ err }, 'não foi possível ler a configuração do painel; mantendo a anterior');
      }
    }
    if (!this.started) return;
    this.reconcile();
    if (!db) return;
    try {
      await reportRuntimeEnv(db, this.options.profile, envReport(this.options.profile, this.options.env));
    } catch (err) {
      this.log.warn({ err }, 'não foi possível relatar o env ao painel');
    }
    await this.pollRequests();
  }

  private applyConfig(overrides: Map<string, string>): void {
    const { env, applied, rejected, converted } = applyOverrides(this.options.env, overrides);
    const key = JSON.stringify([...overrides.entries()].sort());
    const changed = key !== this.overridesKey;
    this.overridesKey = key;
    if (changed) {
      if (applied.length || overrides.size === 0)
        this.log.info(
          { overrides: Object.fromEntries(applied.map((k) => [k, env[k]])) },
          'configuração do painel aplicada',
        );
      if (rejected.length) this.log.warn({ rejected }, 'sobrescritas do painel ignoradas (inválidas)');
      // ex.: AI_DAILY_USD_BUDGET=0 (antes "IA desligada") vale como AI_STATUS=off
      if (converted.length)
        this.log.warn({ converted }, 'sobrescritas antigas do painel convertidas para o estado literal');
    }
    this.env = env;
    try {
      this.current = scheduleFromEnv(env, this.options.jobs);
    } catch (err) {
      // env do contêiner com agenda inválida: segue com a agenda anterior
      this.log.error({ err }, 'agenda inválida; mantendo a anterior');
    }
  }

  /** Para os crons que mudaram ou saíram e programa os novos; sobe os jobs `keepAlive` que não estão no ar. */
  private reconcile(): void {
    const wanted = new Map(this.current.filter((j) => !j.keepAlive).map((j) => [j.name, j]));
    const names = new Set([...this.crons.keys(), ...wanted.keys()]);
    const changes: { job: string; from: string | null; to: string | null }[] = [];
    for (const name of names) {
      const active = this.crons.get(name);
      const job = wanted.get(name);
      if (active?.pattern === job?.cron) continue;
      changes.push({ job: name, from: active?.pattern ?? null, to: job?.cron ?? null });
      active?.cron.stop();
      this.crons.delete(name);
      if (job) this.crons.set(name, { pattern: job.cron, cron: this.cronFor(job) });
    }
    // a primeira programação não é "mudança"; as seguintes vêm do painel
    if (changes.length && this.programmed) this.log.info({ changes }, 'agenda reprogramada');
    this.programmed = true;
    for (const job of this.current) if (job.keepAlive) this.keepAlive(job.name);
  }

  /**
   * Sobe o job `keepAlive` se ele não está no ar nem esperando a hora de voltar. Desligado no painel (fora da agenda),
   * o processo em andamento segue até sair e não volta.
   */
  private keepAlive(name: string): void {
    if (!this.started || this.running.has(name) || this.relaunch.has(name)) return;
    const startedAt = Date.now();
    let run: Promise<RunResult>;
    try {
      run = this.execute(name, 'keepalive');
    } catch (err) {
      this.log.error({ err, job: name }, 'falha ao subir o job que fica no ar');
      return;
    }
    this.track(
      run.then(
        (result) => this.scheduleRelaunch(name, Date.now() - startedAt, result.status),
        (err: unknown) => {
          this.log.error({ err, job: name }, 'falha ao subir o job que fica no ar');
          this.scheduleRelaunch(name, Date.now() - startedAt, 'error');
        },
      ),
    );
  }

  private scheduleRelaunch(name: string, ranMs: number, status: RunResult['status']): void {
    if (!this.started) return;
    const min = this.options.keepAliveDelayMs ?? 1_000;
    const max = Math.max(min, this.options.keepAliveMaxDelayMs ?? 60_000);
    // ficou no ar e saiu: volta logo; caiu logo depois de subir (sem banco, sem chave): espera cada vez mais
    const quick = ranMs < KEEPALIVE_STABLE_MS;
    const delay = quick ? Math.min(max, this.backoff.get(name) ?? min) : min;
    this.backoff.set(name, quick ? Math.min(max, delay * 2) : min);
    const fields = { job: name, status, ran_ms: ranMs, retry_ms: delay };
    if (quick && status !== 'ok')
      this.log.warn(fields, 'job que fica no ar saiu logo depois de subir; subindo de novo');
    else this.log.info(fields, 'job que fica no ar saiu; subindo de novo');
    const timer = setTimeout(() => {
      this.relaunch.delete(name);
      if (this.current.some((j) => j.name === name && j.keepAlive)) this.keepAlive(name);
    }, delay);
    timer.unref?.();
    this.relaunch.set(name, timer);
  }

  private cronFor(job: ScheduledJob): Cron {
    return new Cron(
      job.cron,
      {
        name: job.name,
        timezone: 'UTC',
        mode: '5-part',
        protect: () =>
          this.log.warn({ job: job.name }, 'execução anterior ainda em andamento; pulando este horário'),
        catch: (err: unknown) => this.log.error({ err, job: job.name }, 'erro no agendamento'),
      },
      async () => {
        if (this.running.has(job.name)) {
          this.log.warn({ job: job.name }, 'execução anterior ainda em andamento; pulando este horário');
          return;
        }
        await this.execute(job.name, 'schedule');
      },
    );
  }

  /**
   * Executa um job agora com o env efetivo. `panel` e `manual` aceitam um job desligado na agenda
   * (rodar sob demanda é justamente o uso de um job sem agenda).
   */
  execute(name: string, trigger: RunTrigger): Promise<RunResult> {
    const job =
      this.current.find((j) => j.name === name) ??
      (trigger === 'panel' || trigger === 'manual'
        ? this.options.jobs.find((j) => j.name === name)
        : undefined);
    if (!job)
      throw new Error(
        `Job desconhecido ou desligado: "${name}". Disponíveis: ${this.current.map((j) => j.name).join(', ')}`,
      );
    // sob demanda, alguns jobs mudam de modo (ex.: a reconciliação do ao vivo confere tudo)
    const onDemand = (trigger === 'panel' || trigger === 'manual') && job.onDemandArgs;
    const target = onDemand ? { ...job, args: job.onDemandArgs! } : job;
    // marcado como em andamento já na fila: o cron seguinte do mesmo job pula em vez de enfileirar de novo
    const run = this.admit(job).then(async (release) => {
      if (!release) return queueClosed(job.name);
      try {
        // o env do momento em que a vaga abriu (o painel pode ter mudado algo enquanto esperava)
        return await this.options.run(target, { trigger, env: this.env });
      } finally {
        release();
      }
    });
    this.running.set(name, run);
    void run
      .finally(() => {
        if (this.running.get(name) === run) this.running.delete(name);
      })
      .catch(() => {});
    return run;
  }

  /**
   * Roda agora, uma vez, os jobs cujo último horário passou sem execução (catch-up.ts). Pula o que já está rodando
   * (cron do mesmo minuto, SCHEDULER_RUN_ON_START) e o que saiu da agenda; a trava do job pula o que outro processo
   * roda. Entra na fila do teto de jobs como qualquer outro.
   */
  catchUp(missed: readonly MissedSlot[]): void {
    for (const m of missed) {
      if (this.running.has(m.job) || !this.current.some((j) => j.name === m.job)) continue;
      this.log.info(
        { job: m.job, slot: m.slot.toISOString() },
        'catch-up: horário perdido com o scheduler fora do ar; rodando agora',
      );
      this.track(this.execute(m.job, 'catchup'));
    }
  }

  /** Vaga no teto de jobs simultâneos; a faixa do ao vivo nunca espera. */
  private async admit(job: ScheduledJob): Promise<(() => void) | null> {
    if (!this.slots || job.live || job.keepAlive) return () => {};
    if (this.slots.running >= this.slots.max)
      this.log.info(
        {
          job: job.name,
          max_jobs: this.slots.max,
          queued: this.slots.queued + 1,
          running: [...this.running.keys()],
        },
        'teto de jobs simultâneos atingido; job na fila',
      );
    return this.slots.acquire();
  }

  private async pollRequests(): Promise<void> {
    const { db } = this.options;
    if (!db) return;
    const names = [
      ...this.options.jobs.map((j) => j.name),
      ...(this.options.creditCheck ? [AI_CREDIT_CHECK] : []),
    ];
    let claimed: ClaimedJobRequest[];
    try {
      claimed = await claimJobRequests(db, names);
    } catch (err) {
      this.log.warn({ err }, 'não foi possível ler os pedidos de "rodar agora"');
      return;
    }
    for (const req of claimed) this.track(this.serve(db, req));
  }

  private async serve(db: Database, req: ClaimedJobRequest): Promise<void> {
    const log = this.log.child({ job: req.job, request_id: req.id, requested_by: req.requestedBy });
    try {
      if (req.job === AI_CREDIT_CHECK) {
        await this.checkCredit();
        await finishJobRequest(db, req.id, { status: 'done' });
        return;
      }
      if (!scheduledJob(req.job)?.runNow) {
        await finishJobRequest(db, req.id, { status: 'skipped', detail: 'not_allowed' });
        return;
      }
      if (this.running.has(req.job)) {
        await finishJobRequest(db, req.id, { status: 'skipped', detail: 'already_running' });
        return;
      }
      log.info({}, 'rodando job pedido pelo painel');
      const result = await this.execute(req.job, 'panel');
      if (result.status === 'skipped') {
        // outro processo (ex.: um `scheduler --run` no console) já está rodando o job
        await finishJobRequest(db, req.id, { status: 'skipped', detail: 'already_running' });
        return;
      }
      await finishJobRequest(db, req.id, {
        status: result.status === 'ok' || result.status === 'budget_skipped' ? 'done' : 'error',
        runId: result.runId,
        detail:
          result.status === 'ok'
            ? null
            : result.status === 'budget_skipped'
              ? 'budget_skipped'
              : `exit_code=${result.exitCode ?? '-'}${result.timedOut ? ' timeout' : ''}`,
      });
    } catch (err) {
      log.error({ err }, 'falha ao atender pedido do painel');
      await finishJobRequest(db, req.id, {
        status: 'error',
        detail: err instanceof Error ? err.message.slice(0, 300) : String(err),
      }).catch(() => {});
    }
  }

  private async checkCredit(): Promise<void> {
    const { db, creditCheck } = this.options;
    if (!creditCheck) return;
    const result = await creditCheck(this.env);
    const log = result.status === 'pass' ? this.log.info.bind(this.log) : this.log.warn.bind(this.log);
    log({ credit: result.detail }, 'crédito da conta de IA verificado');
    if (db)
      await saveRuntimeCheck(db, {
        service: this.options.profile,
        name: AI_CREDIT_CHECK,
        status: result.status,
        detail: JSON.stringify(result.detail),
      }).catch((err: unknown) => this.log.warn({ err }, 'não foi possível gravar a checagem de crédito'));
    await reportAiHeartbeat(this.env.AI_HEARTBEAT_URL, result.status).catch((err: unknown) =>
      this.log.warn({ err }, 'não foi possível avisar o heartbeat da IA'),
    );
  }

  private track(p: Promise<unknown>): void {
    const tracked = p.catch((err: unknown) => this.log.error({ err }, 'falha em tarefa do scheduler'));
    this.background.add(tracked);
    void tracked.finally(() => this.background.delete(tracked));
  }

  /** Para de agendar; devolve as execuções em andamento (o chamador decide quanto esperar). */
  stop(): Promise<unknown>[] {
    this.started = false;
    // quem ainda esperava vaga não começa mais
    this.slots?.close();
    clearInterval(this.refreshTimer);
    clearInterval(this.creditTimer);
    for (const t of this.relaunch.values()) clearTimeout(t);
    this.relaunch.clear();
    for (const c of this.crons.values()) c.cron.stop();
    this.crons.clear();
    this.programmed = false;
    return [...this.running.values(), ...this.background];
  }
}

/** Job que esperava vaga quando o scheduler encerrou: não rodou (sem registro em ops.job_run). */
function queueClosed(job: string): RunResult {
  return {
    job,
    runId: undefined,
    status: 'skipped',
    exitCode: null,
    signal: null,
    timedOut: false,
    durationMs: 0,
  };
}

/** Próxima execução de cada job da agenda efetiva (para logs e `--list`). */
export function describeSchedule(jobs: readonly ScheduledJob[], count = 2) {
  return jobs.map((j) => ({
    job: j.name,
    cron: j.cron,
    script: j.script,
    next: nextRuns(j, count).map((d) => d.toISOString()),
    description: j.description,
  }));
}
