import {
  ApiSportsError,
  normalizeParams,
  OfflineMissError,
  PlanViolationError,
  QuotaExceededError,
  requestHash,
  ttlFor,
  type ApiSport,
  type ApiSportsClient,
  type Envelope,
  type Params,
  type PlanRules,
  type Priority,
} from '@galaxie/apisports-client';
import { attemptsOf, cursorId, MAX_ATTEMPTS, type CursorRef, type CursorStore } from './cursor-store.js';
import type { JobRunStore } from './job-run-store.js';
import type { RawSource } from './raw-source.js';

export type SkipReason = 'no_coverage';

/** Uma chamada planejada de um job (ainda não executada). */
export interface PlannedRequest {
  /** Passo do plano (ex.: "fixtures", "standings", "detalhe"). */
  step: string;
  sport: ApiSport;
  endpoint: string;
  /** Parâmetros já normalizados. */
  params: Record<string, string>;
  /** Cursores concluídos quando a chamada dá certo (um lote de `ids` conclui um cursor por partida). */
  cursors: CursorRef[];
  /** Cursor concluído antes deste instante é tratado como pendente (sync diário, rodízio de entidades). */
  staleBefore?: Date | undefined;
  /** Sobrescreve o TTL do endpoint ao decidir entre cache e rede. */
  maxAgeMs?: number | undefined;
  /** Item listado no plano, mas que nunca é chamado (ex.: `coverage` = false). */
  skip?: SkipReason | undefined;
}

/** Chave do cursor: parâmetros normalizados em query string ("*" quando não há parâmetros). */
export function paramsKey(params: Params): string {
  return new URLSearchParams(normalizeParams(params)).toString() || '*';
}

export function plannedRequest(
  step: string,
  sport: ApiSport,
  endpoint: string,
  params: Params,
  extra: Partial<Omit<PlannedRequest, 'step' | 'sport' | 'endpoint' | 'params'>> = {},
): PlannedRequest {
  const normalized = normalizeParams(params);
  return {
    step,
    sport,
    endpoint,
    params: normalized,
    cursors: extra.cursors ?? [{ sport, endpoint, key: paramsKey(normalized) }],
    ...(extra.staleBefore ? { staleBefore: extra.staleBefore } : {}),
    ...(extra.maxAgeMs !== undefined ? { maxAgeMs: extra.maxAgeMs } : {}),
    ...(extra.skip ? { skip: extra.skip } : {}),
  };
}

/** Une pedidos idênticos (mesmo endpoint e parâmetros) somando os cursores. */
export function dedupeRequests(items: PlannedRequest[]): PlannedRequest[] {
  const byKey = new Map<string, PlannedRequest>();
  for (const item of items) {
    const key = `${item.sport}|${item.endpoint}|${paramsKey(item.params)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...item, cursors: [...item.cursors] });
      continue;
    }
    const seen = new Set(prev.cursors.map(cursorId));
    for (const c of item.cursors) if (!seen.has(cursorId(c))) prev.cursors.push(c);
    if (prev.skip && !item.skip) delete prev.skip;
  }
  return [...byKey.values()];
}

/** Fase de um job: montada só quando chega a vez dela, a partir do que já está no raw. */
export interface Phase {
  name: string;
  build(): Promise<PlannedRequest[]>;
}

export interface JobSpec {
  /** Nome em ops.job_run (ex.: "bootstrap:seasons"). */
  job: string;
  priority: Priority;
  phases: Phase[];
}

export type ItemStatus = 'done' | 'cache' | 'network' | 'blocked' | 'failed' | 'no_coverage';

export interface StepCounts {
  total: number;
  /** Concluído em execução anterior (ops.sync_cursor). */
  done: number;
  /** Servido do raw, sem gastar cota. */
  cache: number;
  /** Gasta (ou gastaria) cota. */
  network: number;
  /** Fora do plano vigente (temporada, data, parâmetro) ou ausente no modo offline. */
  blocked: number;
  /** Erro do fornecedor (no plano: desistido após várias tentativas). */
  failed: number;
  /** `coverage` = false: não chamado. */
  noCoverage: number;
  /** Ficou para a próxima execução (cota ou limite de chamadas). */
  pending: number;
}

export function emptyCounts(): StepCounts {
  return { total: 0, done: 0, cache: 0, network: 0, blocked: 0, failed: 0, noCoverage: 0, pending: 0 };
}

export interface PhaseReport {
  name: string;
  steps: Record<string, StepCounts>;
  /** No plano: a fase depende de chamadas ainda não feitas da fase anterior (estimativa por baixo). */
  partial: boolean;
}

export interface JobDeps {
  cursors: CursorStore;
  raw: RawSource;
  plan: PlanRules;
  now: () => Date;
}

export interface RunDeps extends JobDeps {
  client: ApiSportsClient;
  runs: JobRunStore;
}

export interface FetchedRequest extends PlannedRequest {
  source: 'cache' | 'network';
  requestHash: string;
}

/**
 * Gancho chamado após cada resposta obtida (rede ou cache). A normalização raw → core (#22) se pluga aqui;
 * o padrão é não fazer nada: os jobs só buscam e guardam o raw.
 */
export type AfterFetch = (envelope: Envelope, request: FetchedRequest) => void | Promise<void>;

export const noopAfterFetch: AfterFetch = () => {};

function hashOf(item: PlannedRequest): string {
  return requestHash('api-sports', item.sport, item.endpoint, item.params);
}

/** Situação de cada item sem chamar o fornecedor: cursor, plano vigente e frescor do raw. */
export async function classify(items: PlannedRequest[], deps: JobDeps, force = false): Promise<ItemStatus[]> {
  const now = deps.now();
  const states = await deps.cursors.load(items.flatMap((i) => i.cursors));
  const fetched = await deps.raw.lastFetched(items.filter((i) => !i.skip).map(hashOf));
  return items.map((item): ItemStatus => {
    if (item.skip) return 'no_coverage';
    if (!force && item.cursors.length) {
      const cs = item.cursors.map((c) => states.get(cursorId(c)));
      const done = cs.every(
        (s) => s?.completedAt && (!item.staleBefore || s.completedAt.getTime() >= item.staleBefore.getTime()),
      );
      if (done) return 'done';
      if (cs.some((s) => !s?.completedAt && attemptsOf(s) >= MAX_ATTEMPTS)) return 'failed';
    }
    try {
      deps.plan.validate(item.params, now);
    } catch (err) {
      if (err instanceof PlanViolationError) return 'blocked';
      throw err;
    }
    const at = fetched.get(hashOf(item));
    const maxAge = item.maxAgeMs ?? ttlFor(item.endpoint, item.params, now);
    if (at && maxAge > 0 && now.getTime() - at.getTime() <= maxAge) return 'cache';
    return 'network';
  });
}

function countInto(steps: Record<string, StepCounts>, step: string, field: keyof StepCounts): void {
  const c = (steps[step] ??= emptyCounts());
  c.total += 1;
  if (field !== 'total') c[field] += 1;
}

const FIELD: Record<ItemStatus, keyof StepCounts> = {
  done: 'done',
  cache: 'cache',
  network: 'network',
  blocked: 'blocked',
  failed: 'failed',
  no_coverage: 'noCoverage',
};

export interface JobPlan {
  job: string;
  phases: PhaseReport[];
  totals: StepCounts;
}

export function sumCounts(phases: PhaseReport[]): StepCounts {
  const t = emptyCounts();
  for (const p of phases)
    for (const c of Object.values(p.steps))
      for (const k of Object.keys(t) as (keyof StepCounts)[]) t[k] += c[k];
  return t;
}

/**
 * `--plan`: mostra, por passo, o que já foi feito, o que sairia do raw e o que gastaria cota — sem chamar.
 * Fases dependentes são montadas a partir do raw atual (marcadas como parciais se a anterior ainda gastaria cota).
 */
export async function planJob(
  spec: JobSpec,
  deps: JobDeps,
  opts: { force?: boolean } = {},
): Promise<JobPlan> {
  const phases: PhaseReport[] = [];
  let previousNeedsNetwork = false;
  for (const phase of spec.phases) {
    const items = dedupeRequests(await phase.build());
    const statuses = await classify(items, deps, opts.force);
    const steps: Record<string, StepCounts> = {};
    items.forEach((item, i) => countInto(steps, item.step, FIELD[statuses[i]!]));
    phases.push({ name: phase.name, steps, partial: previousNeedsNetwork });
    previousNeedsNetwork ||= statuses.some((s) => s === 'network');
  }
  return { job: spec.job, phases, totals: sumCounts(phases) };
}

export interface RunOptions {
  /** Máximo de chamadas que gastam cota nesta execução. */
  maxCalls?: number | undefined;
  /** Ignora os cursores (refaz tudo; o cache do raw continua valendo). */
  force?: boolean | undefined;
  afterFetch?: AfterFetch | undefined;
}

export type StopReason = 'quota' | 'max_calls' | 'provider';

export interface JobReport {
  job: string;
  runId: string;
  status: 'ok' | 'partial';
  stoppedBy?: StopReason | undefined;
  reason?: string | undefined;
  phases: PhaseReport[];
  /** Fases que nem chegaram a ser montadas porque a execução parou antes. */
  skippedPhases: string[];
  callsSpent: number;
  totals: StepCounts;
}

/** Erros do fornecedor que valem para a API inteira: não adianta seguir tentando outros itens. */
const PROVIDER_WIDE = new Set(['quota_exhausted', 'rate_limited', 'auth_error']);

/**
 * Executa as fases em ordem, item a item, pelo ApiSportsClient (cache → plano → Governor → rede).
 * Cada item concluído marca seus cursores; ao esbarrar na cota (ou no `maxCalls`) para graciosamente,
 * registra o que ficou pendente e a próxima execução continua de onde parou.
 */
export async function runJob(spec: JobSpec, deps: RunDeps, opts: RunOptions = {}): Promise<JobReport> {
  const runId = await deps.runs.start(spec.job);
  const afterFetch = opts.afterFetch ?? noopAfterFetch;
  const phases: PhaseReport[] = [];
  const skippedPhases: string[] = [];
  let callsSpent = 0;
  let stoppedBy: StopReason | undefined;
  let reason: string | undefined;
  const stop = (why: StopReason, message: string) => {
    stoppedBy ??= why;
    reason ??= message;
  };

  try {
    for (const phase of spec.phases) {
      if (stoppedBy) {
        skippedPhases.push(phase.name);
        continue;
      }
      const items = dedupeRequests(await phase.build());
      const statuses = await classify(items, deps, opts.force);
      const steps: Record<string, StepCounts> = {};
      phases.push({ name: phase.name, steps, partial: false });

      for (const [i, item] of items.entries()) {
        const status = statuses[i]!;
        if (status !== 'cache' && status !== 'network') {
          countInto(steps, item.step, FIELD[status]);
          continue;
        }
        if (stoppedBy) {
          countInto(steps, item.step, 'pending');
          continue;
        }
        if (status === 'network' && opts.maxCalls !== undefined && callsSpent >= opts.maxCalls) {
          stop('max_calls', `limite de ${opts.maxCalls} chamadas desta execução atingido`);
          countInto(steps, item.step, 'pending');
          continue;
        }
        try {
          const res = await deps.client.get({
            sport: item.sport,
            endpoint: item.endpoint,
            params: item.params,
            priority: spec.priority,
            jobId: `job-run:${runId}`,
            ...(item.maxAgeMs !== undefined ? { maxAgeMs: item.maxAgeMs } : {}),
          });
          if (res.source === 'network') callsSpent += 1;
          countInto(steps, item.step, res.source);
          await afterFetch(res.envelope, { ...item, source: res.source, requestHash: res.requestHash });
          await deps.cursors.complete(
            item.cursors,
            {
              requestHash: res.requestHash,
              results: res.envelope.results,
              source: res.source,
              jobRunId: runId,
              fetchedAt: res.fetchedAt.toISOString(),
            },
            deps.now(),
          );
        } catch (err) {
          if (err instanceof QuotaExceededError) {
            stop('quota', err.message);
            countInto(steps, item.step, 'pending');
          } else if (err instanceof PlanViolationError || err instanceof OfflineMissError) {
            countInto(steps, item.step, 'blocked');
          } else if (err instanceof ApiSportsError) {
            callsSpent += 1;
            countInto(steps, item.step, 'failed');
            if (PROVIDER_WIDE.has(err.outcome)) {
              stop('provider', err.message);
            } else {
              await deps.cursors.fail(item.cursors, err.message.slice(0, 500), deps.now());
            }
          } else {
            throw err;
          }
        }
      }
    }
  } catch (err) {
    await deps.runs.finish(runId, {
      status: 'error',
      callsSpent,
      stats: { phases, skippedPhases },
      error: String(err),
    });
    throw err;
  }

  const totals = sumCounts(phases);
  const report: JobReport = {
    job: spec.job,
    runId,
    status: stoppedBy ? 'partial' : 'ok',
    stoppedBy,
    reason,
    phases,
    skippedPhases,
    callsSpent,
    totals,
  };
  await deps.runs.finish(runId, {
    status: report.status,
    callsSpent,
    stats: { phases, skippedPhases, totals, ...(stoppedBy ? { stoppedBy, reason } : {}) },
  });
  return report;
}
