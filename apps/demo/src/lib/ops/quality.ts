/**
 * Placar da qualidade dos dados (job `data-quality` do ingestor, tabelas `ops.quality_*`): o último resultado de
 * cada regra em cada esporte, a série das execuções anteriores para a tendência e as falhas do último resultado.
 * Sem as tabelas (migration 0034 pendente), null: o resto do painel continua.
 */
import { pool } from '@/lib/auth/db';

import type { QualityFailureRow, QualityResultRow, QualityRuleInfo, QualitySnapshot } from './types';

/** Execuções na série da tendência. */
export const TREND_RUNS = 14;
/** Falhas enviadas ao navegador (as mais graves primeiro). */
export const FAILURES_LIMIT = 1000;

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export async function readQuality(): Promise<QualitySnapshot | null> {
  try {
    const [rules, latest, series, failures, runs] = await Promise.all([
      pool.query<{
        id: string;
        sport: string;
        area: string;
        severity: QualityRuleInfo['severity'];
        description: Record<string, string>;
        origin: string | null;
      }>('select id, sport, area, severity, description, origin from ops.quality_rule order by id'),
      // último resultado de cada regra × esporte (uma execução com --regras só atualiza as suas)
      pool.query<{
        rule_id: string;
        sport: string;
        severity: QualityResultRow['severity'];
        status: QualityResultRow['status'];
        checked: number;
        failed: number;
        detail: string | null;
        run_at: Date;
      }>(
        `select distinct on (r.rule_id, r.sport) r.rule_id, r.sport, r.severity, r.status, r.checked, r.failed, r.detail,
                run.started_at as run_at
           from ops.quality_result r join ops.quality_run run on run.id = r.run_id and run.status = 'done'
          order by r.rule_id, r.sport, run.started_at desc`,
      ),
      pool.query<{ rule_id: string; sport: string; failed: number; n: number }>(
        `select rule_id, sport, failed, n from (
           select r.rule_id, r.sport, r.failed,
                  row_number() over (partition by r.rule_id, r.sport order by run.started_at desc)::int as n
             from ops.quality_result r join ops.quality_run run on run.id = r.run_id and run.status = 'done'
            where r.status in ('pass', 'fail')
         ) x where n <= $1`,
        [TREND_RUNS],
      ),
      pool.query<{
        rule_id: string;
        sport: string;
        label: string;
        current: string | null;
        expected: string | null;
        link: QualityFailureRow['link'];
        first_seen_at: Date;
        total: number;
      }>(
        `with latest as (
           select distinct on (r.rule_id, r.sport) r.run_id, r.rule_id, r.sport, r.severity
             from ops.quality_result r join ops.quality_run run on run.id = r.run_id and run.status = 'done'
            order by r.rule_id, r.sport, run.started_at desc
         )
         select f.rule_id, f.sport, f.label, f.current, f.expected, f.link, f.first_seen_at,
                count(*) over ()::int as total
           from ops.quality_failure f
           join latest l on l.run_id = f.run_id and l.rule_id = f.rule_id and l.sport = f.sport
          order by array_position(array['critical', 'high', 'medium', 'low'], l.severity), f.rule_id, f.sport,
                   f.first_seen_at, f.id
          limit $1`,
        [FAILURES_LIMIT],
      ),
      pool.query<{
        started_at: Date;
        finished_at: Date | null;
        trigger: string;
        rules: number;
        failed: number;
      }>(
        `select started_at, finished_at, trigger, rules, failed from ops.quality_run
          where status = 'done' order by started_at desc limit 1`,
      ),
    ]);
    const trend = new Map<string, number[]>();
    for (const r of series.rows.sort((a, b) => b.n - a.n)) {
      const k = `${r.rule_id}|${r.sport}`;
      trend.set(k, [...(trend.get(k) ?? []), Number(r.failed)]);
    }
    const run = runs.rows[0];
    return {
      lastRun: run
        ? {
            startedAt: iso(run.started_at)!,
            finishedAt: iso(run.finished_at),
            trigger: run.trigger,
            rules: run.rules,
            failed: run.failed,
          }
        : null,
      rules: rules.rows,
      results: latest.rows.map((r) => ({
        ruleId: r.rule_id,
        sport: r.sport,
        severity: r.severity,
        status: r.status,
        checked: Number(r.checked),
        failed: Number(r.failed),
        detail: r.detail,
        runAt: iso(r.run_at)!,
        trend: trend.get(`${r.rule_id}|${r.sport}`) ?? [],
      })),
      failures: failures.rows.map((f) => ({
        ruleId: f.rule_id,
        sport: f.sport,
        label: f.label,
        current: f.current,
        expected: f.expected,
        link: f.link,
        firstSeenAt: iso(f.first_seen_at)!,
      })),
      failuresTotal: failures.rows[0]?.total ?? 0,
    };
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return null;
    throw err;
  }
}
