/**
 * Roda as regras de qualidade, divide o resultado por esporte e grava a execução em `ops.quality_*` (o placar do
 * painel). Uma regra que falha ao rodar sai como `error` e não derruba as outras; sem a fonte de que precisa,
 * `skipped` com o motivo (nunca `pass`).
 */
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  qualityFailure,
  qualityResult,
  qualityRule,
  qualityRun,
  type Database,
  type QualitySeverity,
  type QualityStatus,
} from '@galaxie/db';
import type { QualityContext, QualityFailureItem, QualityRule, RuleOutcome } from './types.js';

/** Falhas guardadas por regra e esporte numa execução (a contagem `failed` é sempre a completa). */
export const MAX_STORED_FAILURES = 200;
/** Retenção: as falhas ficam 30 dias; o placar (resultados), 180. */
export const FAILURE_RETENTION_DAYS = 30;
export const RESULT_RETENTION_DAYS = 180;

export interface RuleResultRow {
  ruleId: string;
  sport: string;
  severity: QualitySeverity;
  status: QualityStatus;
  checked: number;
  failed: number;
  detail: string | null;
  durationMs: number;
  failures: QualityFailureItem[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Resultado de uma regra → uma linha por esporte. */
export function splitBySport(rule: QualityRule, outcome: RuleOutcome, durationMs: number): RuleResultRow[] {
  const sports = new Set<string>();
  const checkedOf = (s: string) =>
    typeof outcome.checked === 'number' ? outcome.checked : (outcome.checked[s] ?? 0);
  const sportOf = (f: QualityFailureItem) => f.sport ?? rule.sport;
  if (typeof outcome.checked === 'number') sports.add(rule.sport);
  else for (const s of Object.keys(outcome.checked)) sports.add(s);
  for (const f of outcome.failures) sports.add(sportOf(f));
  if (outcome.failed && typeof outcome.failed !== 'number')
    for (const s of Object.keys(outcome.failed)) sports.add(s);
  if (!sports.size) sports.add(rule.sport);
  return [...sports].sort().map((sport) => {
    const failures = outcome.failures.filter((f) => sportOf(f) === sport);
    const failed =
      outcome.failed === undefined
        ? failures.length
        : typeof outcome.failed === 'number'
          ? outcome.failed
          : (outcome.failed[sport] ?? failures.length);
    return {
      ruleId: rule.id,
      sport,
      severity: rule.severity,
      status: failed > 0 ? 'fail' : 'pass',
      checked: Math.max(checkedOf(sport), failed),
      failed,
      detail: null,
      durationMs,
      failures: failures.slice(0, MAX_STORED_FAILURES),
    };
  });
}

/** Por que a regra não pode rodar agora (fonte que falta), ou null. */
async function missingNeed(rule: QualityRule, ctx: QualityContext): Promise<string | null> {
  for (const need of rule.needs ?? []) {
    if (need === 'api' && !ctx.api) return 'API não configurada (QUALITY_API_URL e QUALITY_API_KEY)';
    if (need === 'f1db')
      try {
        await ctx.f1db();
      } catch (err) {
        return `F1DB indisponível: ${message(err)}`;
      }
  }
  return null;
}

export interface RunOptions {
  /** Só estas regras (ids, ou prefixos terminados em `.`: `f1.`). */
  only?: readonly string[] | undefined;
  /** Só as regras deste esporte (e as `all`). */
  sport?: string | undefined;
}

export function selectRules(rules: readonly QualityRule[], options: RunOptions = {}): QualityRule[] {
  return rules.filter(
    (r) =>
      (!options.only?.length ||
        options.only.some((o) => (o.endsWith('.') ? r.id.startsWith(o) : r.id === o))) &&
      (!options.sport || r.sport === options.sport || r.sport === 'all'),
  );
}

export async function runRules(rules: readonly QualityRule[], ctx: QualityContext): Promise<RuleResultRow[]> {
  const rows: RuleResultRow[] = [];
  for (const rule of rules) {
    const started = Date.now();
    const base = {
      ruleId: rule.id,
      sport: rule.sport,
      severity: rule.severity,
      checked: 0,
      failed: 0,
      failures: [],
    };
    const skip = await missingNeed(rule, ctx);
    if (skip) {
      rows.push({ ...base, status: 'skipped', detail: skip, durationMs: Date.now() - started });
      ctx.log(`${rule.id}: pulada (${skip})`);
      continue;
    }
    try {
      const outcome = await rule.check(ctx);
      const split = splitBySport(rule, outcome, Date.now() - started);
      rows.push(...split);
      ctx.log(
        `${rule.id}: ${split.map((r) => `${r.sport} ${r.failed}/${r.checked}`).join(', ')} (${Date.now() - started} ms)`,
      );
    } catch (err) {
      rows.push({ ...base, status: 'error', detail: message(err), durationMs: Date.now() - started });
      ctx.log(`${rule.id}: erro (${message(err)})`);
    }
  }
  return rows;
}

const failureKey = (ruleId: string, sport: string, key: string) => `${ruleId}|${sport}|${key}`;

/**
 * Grava a execução: o catálogo das regras, o placar por esporte (com pass zerado para o esporte que saiu do escopo de
 * uma regra) e as falhas (com o "desde" do resultado anterior da mesma regra × esporte).
 */
export async function saveRun(
  db: Database,
  rules: readonly QualityRule[],
  rows: readonly RuleResultRow[],
  options: { trigger: 'schedule' | 'cli'; startedAt: Date; finishedAt?: Date },
): Promise<string> {
  const finishedAt = options.finishedAt ?? new Date();
  return db.transaction(async (tx) => {
    for (const r of rules) {
      const values = {
        sport: r.sport,
        area: r.area,
        severity: r.severity,
        description: r.description,
        origin: r.origin ?? null,
        updatedAt: finishedAt,
      };
      await tx
        .insert(qualityRule)
        .values({ id: r.id, ...values })
        .onConflictDoUpdate({ target: qualityRule.id, set: values });
    }
    const ruleIds = [...new Set(rows.map((r) => r.ruleId))];
    // último resultado de cada regra × esporte nas execuções concluídas (só das regras desta execução)
    const latest = (ids: readonly string[], statuses?: QualityStatus[]) =>
      tx
        .selectDistinctOn([qualityResult.ruleId, qualityResult.sport], {
          runId: qualityResult.runId,
          ruleId: qualityResult.ruleId,
          sport: qualityResult.sport,
          status: qualityResult.status,
          checked: qualityResult.checked,
          failed: qualityResult.failed,
        })
        .from(qualityResult)
        .innerJoin(qualityRun, and(eq(qualityRun.id, qualityResult.runId), eq(qualityRun.status, 'done')))
        .where(
          and(
            inArray(qualityResult.ruleId, [...ids]),
            statuses ? inArray(qualityResult.status, statuses) : undefined,
          ),
        )
        .orderBy(qualityResult.ruleId, qualityResult.sport, desc(qualityRun.startedAt));

    // "desde": a mesma falha no último resultado conferido (pass/fail) da regra × esporte continua com a data em que
    // apareceu. É por regra × esporte, não pela última execução: uma gravada com --regras/--esporte não zera as outras
    // (e um error/skipped no meio não diz que a falha sumiu).
    const since = new Map<string, Date>();
    const checkedBefore = ruleIds.length ? await latest(ruleIds, ['pass', 'fail']) : [];
    const lastRun = new Map(checkedBefore.map((r) => [`${r.ruleId}|${r.sport}`, r.runId]));
    const prevRuns = [...new Set(lastRun.values())];
    if (prevRuns.length)
      for (const f of await tx
        .select({
          runId: qualityFailure.runId,
          ruleId: qualityFailure.ruleId,
          sport: qualityFailure.sport,
          itemKey: qualityFailure.itemKey,
          firstSeenAt: qualityFailure.firstSeenAt,
        })
        .from(qualityFailure)
        .where(and(inArray(qualityFailure.runId, prevRuns), inArray(qualityFailure.ruleId, ruleIds))))
        if (lastRun.get(`${f.ruleId}|${f.sport}`) === f.runId)
          since.set(failureKey(f.ruleId, f.sport, f.itemKey), f.firstSeenAt);

    // Regra que rodou (pass/fail) e não trouxe um esporte que tinha resultado: o esporte saiu do escopo (ex.: regra
    // `all` sem itens dele agora). Grava pass zerado, senão a falha antiga fica no placar para sempre; o pass zerado já
    // gravado não se repete a cada execução.
    const ran = ruleIds.filter((id) =>
      rows.filter((r) => r.ruleId === id).every((r) => r.status === 'pass' || r.status === 'fail'),
    );
    const present = new Set(rows.map((r) => `${r.ruleId}|${r.sport}`));
    const severityOf = new Map(rows.map((r) => [r.ruleId, r.severity]));
    const gone: RuleResultRow[] = (ran.length ? await latest(ran) : [])
      .filter(
        (r) =>
          !present.has(`${r.ruleId}|${r.sport}`) &&
          !(r.status === 'pass' && r.checked === 0 && r.failed === 0),
      )
      .map((r) => ({
        ruleId: r.ruleId,
        sport: r.sport,
        severity: severityOf.get(r.ruleId)!,
        status: 'pass',
        checked: 0,
        failed: 0,
        detail: 'sem itens deste esporte na execução',
        durationMs: 0,
        failures: [],
      }));
    const allRows = [...rows, ...gone];

    const [run] = await tx
      .insert(qualityRun)
      .values({
        startedAt: options.startedAt,
        finishedAt,
        trigger: options.trigger,
        status: 'done',
        rules: new Set(rows.map((r) => r.ruleId)).size,
        failed: rows.filter((r) => r.status === 'fail').length,
      })
      .returning({ id: qualityRun.id });
    const runId = run!.id;
    if (allRows.length)
      await tx.insert(qualityResult).values(
        allRows.map((r) => ({
          runId,
          ruleId: r.ruleId,
          sport: r.sport,
          severity: r.severity,
          status: r.status,
          checked: r.checked,
          failed: r.failed,
          detail: r.detail,
          durationMs: r.durationMs,
        })),
      );
    const failures = rows.flatMap((r) =>
      r.failures.map((f) => ({
        runId,
        ruleId: r.ruleId,
        sport: r.sport,
        itemKey: f.key,
        label: f.label,
        current: f.current ?? null,
        expected: f.expected ?? null,
        link: f.link ?? null,
        firstSeenAt: since.get(failureKey(r.ruleId, r.sport, f.key)) ?? finishedAt,
      })),
    );
    for (let i = 0; i < failures.length; i += 500)
      await tx.insert(qualityFailure).values(failures.slice(i, i + 500));
    return runId;
  });
}

/** Retenção: falhas das execuções com mais de 30 dias e execuções com mais de 180 (os resultados vão junto). */
export async function pruneQuality(
  db: Database,
  now: Date = new Date(),
): Promise<{ runs: number; failures: number }> {
  const day = 86_400_000;
  const failureCutoff = new Date(now.getTime() - FAILURE_RETENTION_DAYS * day);
  const runCutoff = new Date(now.getTime() - RESULT_RETENTION_DAYS * day);
  const failures = await db.execute(sql`
    delete from ops.quality_failure f using ops.quality_run r
     where r.id = f.run_id and r.started_at < ${failureCutoff.toISOString()}::timestamptz`);
  const runs = await db
    .delete(qualityRun)
    .where(lt(qualityRun.startedAt, runCutoff))
    .returning({ id: qualityRun.id });
  return { runs: runs.length, failures: failures.count ?? 0 };
}
