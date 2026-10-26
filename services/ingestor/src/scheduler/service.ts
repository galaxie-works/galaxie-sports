/**
 * Scheduler em modo serviço: agenda os jobs do perfil e, a cada `refreshMs` (padrão 30 s), relê a
 * configuração do painel (ops.runtime_setting). Precedência banco > env > padrão: as sobrescritas
 * válidas entram no env de cada job (cada execução é um processo novo, então os jobs leem os valores
 * novos no começo), as agendas mudadas são reprogramadas sem reiniciar o contêiner e os pedidos de
 * "rodar agora" (ops.job_request) são executados. O env do contêiner é relatado em ops.runtime_env
 * (segredos só como configurado/não configurado), que também serve de sinal de vida para o painel.
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
import type { CreditCheckResult } from './ai-credit.js';
import type { RunResult, RunTrigger } from './runner.js';
import { nextRuns, scheduleFromEnv, type ScheduledJob } from './schedule.js';

export type SchedulerProfile = 'ingestor' | 'agents';

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
  creditEveryMs?: number;
}

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

  constructor(private readonly options: SchedulerServiceOptions) {
    this.log = options.log;
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
        this.options.creditEveryMs ?? 6 * 3_600_000,
      );
      this.creditTimer.unref?.();
    }
    this.log.info({ profile: this.options.profile, jobs: this.activeCrons() }, 'scheduler iniciado');
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

  /** Para os crons que mudaram ou saíram e programa os novos. */
  private reconcile(): void {
    const wanted = new Map(this.current.map((j) => [j.name, j]));
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
    const run = this.options.run(onDemand ? { ...job, args: job.onDemandArgs! } : job, {
      trigger,
      env: this.env,
    });
    this.running.set(name, run);
    void run
      .finally(() => {
        if (this.running.get(name) === run) this.running.delete(name);
      })
      .catch(() => {});
    return run;
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
        status: result.status === 'ok' ? 'done' : 'error',
        runId: result.runId,
        detail:
          result.status === 'ok'
            ? null
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
  }

  private track(p: Promise<unknown>): void {
    const tracked = p.catch((err: unknown) => this.log.error({ err }, 'falha em tarefa do scheduler'));
    this.background.add(tracked);
    void tracked.finally(() => this.background.delete(tracked));
  }

  /** Para de agendar; devolve as execuções em andamento (o chamador decide quanto esperar). */
  stop(): Promise<unknown>[] {
    this.started = false;
    clearInterval(this.refreshTimer);
    clearInterval(this.creditTimer);
    for (const c of this.crons.values()) c.cron.stop();
    this.crons.clear();
    this.programmed = false;
    return [...this.running.values(), ...this.background];
  }
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
