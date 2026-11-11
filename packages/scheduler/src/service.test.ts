import { createLogger } from '@galaxie/observability';
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunResult, RunTrigger } from './runner.js';
import type { ScheduledJob } from './schedule.js';
import { SchedulerService } from './service.js';

const logger = createLogger({ service: 'test', level: 'silent' });

const job = (name: string, extra: Partial<ScheduledJob> = {}): ScheduledJob => ({
  name,
  description: '',
  // 1º de janeiro à meia-noite: o cron não dispara durante o teste
  cron: '0 0 1 1 *',
  script: `${name}.js`,
  args: [],
  timeoutMs: 60_000,
  ...extra,
});

const result = (name: string, status: RunResult['status'] = 'ok'): RunResult => ({
  job: name,
  runId: undefined,
  status,
  exitCode: status === 'ok' ? 0 : 1,
  signal: null,
  timedOut: false,
  durationMs: 0,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let running: SchedulerService | undefined;
afterEach(() => {
  running?.stop();
  running = undefined;
});

describe('SchedulerService: job que fica no ar (keepAlive)', () => {
  function supervised(opts: { env?: NodeJS.ProcessEnv; exitAfterMs?: number } = {}) {
    const launches: { job: string; trigger: RunTrigger; at: number }[] = [];
    const s = new SchedulerService({
      profile: 'live',
      jobs: [job('live-run', { keepAlive: true, lock: 'instance', live: true }), job('events-clock')],
      env: opts.env ?? {},
      log: logger,
      maxJobs: 1,
      keepAliveDelayMs: 20,
      keepAliveMaxDelayMs: 80,
      run: async (j, { trigger }) => {
        launches.push({ job: j.name, trigger, at: Date.now() });
        await sleep(opts.exitAfterMs ?? 0);
        return result(j.name, 'error');
      },
    });
    running = s;
    return { s, launches };
  }

  it('sobe na partida sem cron e, quando sai, sobe de novo com atraso que dobra até o teto', async () => {
    const { s, launches } = supervised();
    await s.start();
    expect(s.keptAlive()).toEqual(['live-run']);
    expect(s.activeCrons().map((c) => c.job)).toEqual(['events-clock']);
    await sleep(400);
    const lr = launches.filter((l) => l.job === 'live-run');
    expect(lr.length).toBeGreaterThanOrEqual(4);
    expect(lr.every((l) => l.trigger === 'keepalive')).toBe(true);
    const gaps = lr.slice(1).map((l, i) => l.at - lr[i]!.at);
    // 20, 40, 80, 80… (o timer pode adiantar ~1 ms)
    expect(gaps[0]).toBeGreaterThanOrEqual(18);
    expect(gaps[1]).toBeGreaterThanOrEqual(38);
    expect(gaps[2]).toBeGreaterThanOrEqual(78);
    for (const g of gaps) expect(g).toBeLessThan(80 + 60);
    // o job que fica no ar não ocupa a vaga do teto de jobs
    await expect(s.execute('events-clock', 'manual')).resolves.toMatchObject({ job: 'events-clock' });
  });

  it('enquanto o processo está no ar não sobe outro; no encerramento não volta', async () => {
    const { s, launches } = supervised({ exitAfterMs: 150 });
    await s.start();
    await sleep(60);
    expect(launches).toHaveLength(1);
    expect(s.isRunning('live-run')).toBe(true);
    // o pedido do painel e o cron acham o job rodando
    await s.refresh();
    expect(launches).toHaveLength(1);
    const pending = s.stop();
    await Promise.allSettled(pending);
    await sleep(120);
    expect(launches).toHaveLength(1);
  });

  it('desligado no painel com o processo no ar: o processo recebe o encerramento e não volta', async () => {
    const aborted: string[] = [];
    let launches = 0;
    const env: NodeJS.ProcessEnv = {};
    const s = new SchedulerService({
      profile: 'live',
      jobs: [job('live-run', { keepAlive: true, lock: 'instance', live: true })],
      env,
      log: logger,
      keepAliveDelayMs: 20,
      run: (j, { signal }) => {
        launches += 1;
        return new Promise<RunResult>((resolve) => {
          signal?.addEventListener('abort', () => {
            aborted.push(j.name);
            resolve(result(j.name, 'ok'));
          });
        });
      },
    });
    running = s;
    await s.start();
    await sleep(30);
    expect(launches).toBe(1);
    // o painel desliga (a releitura entrega o env efetivo com SCHEDULE_LIVE_RUN=off)
    (s as unknown as { applyConfig(o: Map<string, string>): void }).applyConfig(
      new Map([['SCHEDULE_LIVE_RUN', 'off']]),
    );
    await s.refresh();
    await sleep(80);
    expect(aborted).toEqual(['live-run']);
    expect(launches).toBe(1);
    expect(s.keptAlive()).toEqual([]);
  });

  it('SCHEDULE_<JOB>=off desliga', async () => {
    const { s, launches } = supervised({ env: { SCHEDULE_LIVE_RUN: 'off' } });
    await s.start();
    await sleep(50);
    expect(s.keptAlive()).toEqual([]);
    expect(launches).toHaveLength(0);
  });
});

describe('SchedulerService: chaves trocadas no painel (#1087)', () => {
  const KEK = 'k'.repeat(40);
  const KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

  function withSealed(env: NodeJS.ProcessEnv) {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => lines.push(JSON.stringify(args));
    const log = { info: capture, warn: capture, error: capture, debug: capture, child: () => log };
    const s = new SchedulerService({
      profile: 'ingestor',
      jobs: [job('quota-status')],
      env,
      log: log as unknown as typeof logger,
      run: async (j) => result(j.name),
    });
    const sealed = new SettingsSecretBox([KEK]).seal('APISPORTS_KEY', KEY);
    (s as unknown as { applyConfig(o: Map<string, string>): void }).applyConfig(
      new Map([['APISPORTS_KEY_SEALED', sealed]]),
    );
    return { s, lines: () => lines.join('\n') };
  }

  it('os jobs recebem a chave aberta com a SETTINGS_KEK do contêiner; o log só leva o nome', () => {
    const { s, lines } = withSealed({ APISPORTS_KEY: 'chave-do-env', SETTINGS_KEK: KEK });
    expect(s.effectiveEnv.APISPORTS_KEY).toBe(KEY);
    expect(lines()).toContain('APISPORTS_KEY');
    expect(lines()).not.toContain(KEY);
    expect(lines()).not.toContain('chave-do-env');
  });

  it('sem a SETTINGS_KEK os jobs ficam com o .env e o aviso não leva valor', () => {
    const { s, lines } = withSealed({ APISPORTS_KEY: 'chave-do-env' });
    expect(s.effectiveEnv.APISPORTS_KEY).toBe('chave-do-env');
    expect(lines()).toContain('sealed');
    expect(lines()).not.toContain(KEY);
  });
});
