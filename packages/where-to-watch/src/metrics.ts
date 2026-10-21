/**
 * Métricas do onde assistir (issue #52, metas de docs/07 §4): cobertura até T-3h, verificação em
 * T-3h, precisão auditada, tempo de correção, estoque de opções, execuções e custo de LLM.
 * `renderPrometheus` gera o formato de exposição de texto do Prometheus.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

export const WTW_TARGETS = {
  /** % de jogos tier 1 com ≥ 1 opção confirmada até T-3h. */
  coverageT3h: 0.95,
  /** Opções publicadas corretas / publicadas (amostra auditada). */
  precision: 0.98,
  /** Nenhum jogo tier 1 sem verificação em T-3h. */
  verificationT3h: 1,
  /** Correção aceita propagada em ≤ 5 min (s). */
  correctionPropagationSec: 300,
} as const;

export interface WtwMetrics {
  windowDays: number;
  generatedAt: string;
  countries: string[];
  coverage: {
    pairs: number;
    coveredT3h: number;
    ratio: number | null;
    verifiedT3h: number;
    verifiedRatio: number | null;
  };
  precision: { correct: number; incorrect: number; unsure: number; ratio: number | null };
  correction: { count: number; avgSec: number | null; p50Sec: number | null; maxSec: number | null };
  options: Record<string, number>;
  runs24h: Record<string, number>;
  auditPending: number;
  llmToday: { agent: string; tokens: number; costUsd: number; calls: number }[];
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Calcula as métricas sobre a janela `days` (padrão 30) até `now`, para os países informados. */
export async function computeWtwMetrics(
  db: Database,
  params: { countries: string[]; now?: Date; days?: number },
): Promise<WtwMetrics> {
  const now = params.now ?? new Date();
  const days = params.days ?? 30;
  const from = new Date(now.getTime() - days * 86_400_000);
  const countries = params.countries.map((c) => c.toUpperCase());

  let coverage: WtwMetrics['coverage'] = {
    pairs: 0,
    coveredT3h: 0,
    ratio: null,
    verifiedT3h: 0,
    verifiedRatio: null,
  };
  if (countries.length) {
    const list = sql.join(
      countries.map((c) => sql`${c}`),
      sql`, `,
    );
    const [row] = await db.execute<{ pairs: string; covered: string; verified: string }>(sql`
      with ev as (
        select e.id, e.starts_at
          from core.event e
          join core.competition c on c.id = e.competition_id
         where c.tier = 1
           and e.starts_at >= ${from.toISOString()}::timestamptz and e.starts_at <= ${now.toISOString()}::timestamptz
           and e.status not in ('postponed', 'cancelled')
      ), pairs as (
        select ev.id, ev.starts_at, cc.country
          from ev cross join unnest(array[${list}]::text[]) as cc(country)
      )
      select count(*) as pairs,
             count(*) filter (where exists (
               select 1 from enrich.broadcast_option o
                where o.event_id = pairs.id and o.country_code = pairs.country and o.status = 'confirmed'
                  and o.created_at <= pairs.starts_at - interval '3 hours'
                  and (o.superseded_at is null or o.superseded_at > pairs.starts_at - interval '3 hours')
             )) as covered,
             count(*) filter (where exists (
               select 1 from enrich.wtw_run r
                where r.event_id = pairs.id and r.country_code = pairs.country and r.status = 'done'
                  and r.finished_at between pairs.starts_at - interval '4 hours' and pairs.starts_at
             )) as verified
        from pairs`);
    const pairs = num(row?.pairs);
    coverage = {
      pairs,
      coveredT3h: num(row?.covered),
      ratio: pairs ? num(row?.covered) / pairs : null,
      verifiedT3h: num(row?.verified),
      verifiedRatio: pairs ? num(row?.verified) / pairs : null,
    };
  }

  const [p] = await db.execute<{ correct: string; incorrect: string; unsure: string }>(sql`
    select count(*) filter (where verdict = 'correct') as correct,
           count(*) filter (where verdict = 'incorrect') as incorrect,
           count(*) filter (where verdict = 'unsure') as unsure
      from enrich.broadcast_audit where reviewed_at >= ${from.toISOString()}::timestamptz`);
  const correct = num(p?.correct);
  const incorrect = num(p?.incorrect);

  const [c] = await db.execute<{ n: string; avg: string | null; p50: string | null; max: string | null }>(sql`
    select count(*) as n,
           avg(extract(epoch from created_at - reported_at)) as avg,
           percentile_cont(0.5) within group (order by extract(epoch from created_at - reported_at)) as p50,
           max(extract(epoch from created_at - reported_at)) as max
      from enrich.broadcast_correction
     where reported_at is not null and created_at >= ${from.toISOString()}::timestamptz`);

  const opts = await db.execute<{ status: string; n: string }>(sql`
    select status::text as status, count(*) as n from enrich.broadcast_option
     where superseded_by is null group by status`);
  const runs = await db.execute<{ status: string; n: string }>(sql`
    select status, count(*) as n from enrich.wtw_run
     where created_at >= ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz group by status`);
  const [pending] = await db.execute<{ n: string }>(
    sql`select count(*) as n from enrich.broadcast_audit where verdict is null`,
  );
  const llm = await db.execute<{ agent: string; tokens: string; cost: string | null; calls: string }>(sql`
    select agent, sum(input_tokens + output_tokens) as tokens, sum(cost_usd) as cost, count(*) as calls
      from ops.llm_usage where day_utc = ${now.toISOString().slice(0, 10)} group by agent order by agent`);

  return {
    windowDays: days,
    generatedAt: now.toISOString(),
    countries,
    coverage,
    precision: {
      correct,
      incorrect,
      unsure: num(p?.unsure),
      ratio: correct + incorrect ? correct / (correct + incorrect) : null,
    },
    correction: {
      count: num(c?.n),
      avgSec: numOrNull(c?.avg),
      p50Sec: numOrNull(c?.p50),
      maxSec: numOrNull(c?.max),
    },
    options: Object.fromEntries(opts.map((r) => [r.status, num(r.n)])),
    runs24h: Object.fromEntries(runs.map((r) => [r.status, num(r.n)])),
    auditPending: num(pending?.n),
    llmToday: llm.map((r) => ({
      agent: r.agent,
      tokens: num(r.tokens),
      costUsd: num(r.cost),
      calls: num(r.calls),
    })),
  };
}

function gauge(
  lines: string[],
  name: string,
  help: string,
  samples: [Record<string, string>, number | null][],
) {
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
  for (const [labels, value] of samples) {
    if (value === null || !Number.isFinite(value)) continue;
    const l = Object.entries(labels)
      .map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '_')}"`)
      .join(',');
    lines.push(`${name}${l ? `{${l}}` : ''} ${value}`);
  }
}

/** Formato de exposição de texto do Prometheus (para um plugin /metrics ou scrape de arquivo). */
export function renderPrometheus(m: WtwMetrics): string {
  const lines: string[] = [];
  gauge(lines, 'galaxie_wtw_coverage_t3h_ratio', 'Jogos tier 1 x pais com opcao confirmada ate T-3h', [
    [{}, m.coverage.ratio],
  ]);
  gauge(
    lines,
    'galaxie_wtw_verification_t3h_ratio',
    'Jogos tier 1 x pais verificados entre T-4h e o inicio',
    [[{}, m.coverage.verifiedRatio]],
  );
  gauge(lines, 'galaxie_wtw_pairs', 'Pares jogo tier 1 x pais na janela', [[{}, m.coverage.pairs]]);
  gauge(lines, 'galaxie_wtw_precision_ratio', 'Precisao auditada (corretas / corretas + incorretas)', [
    [{}, m.precision.ratio],
  ]);
  gauge(lines, 'galaxie_wtw_audits', 'Amostras auditadas por veredito', [
    [{ verdict: 'correct' }, m.precision.correct],
    [{ verdict: 'incorrect' }, m.precision.incorrect],
    [{ verdict: 'unsure' }, m.precision.unsure],
    [{ verdict: 'pending' }, m.auditPending],
  ]);
  gauge(lines, 'galaxie_wtw_correction_seconds', 'Tempo entre o reporte e a correcao', [
    [{ stat: 'avg' }, m.correction.avgSec],
    [{ stat: 'p50' }, m.correction.p50Sec],
    [{ stat: 'max' }, m.correction.maxSec],
  ]);
  gauge(
    lines,
    'galaxie_wtw_options',
    'Opcoes vigentes por status',
    Object.entries(m.options).map(([status, n]) => [{ status }, n]),
  );
  gauge(
    lines,
    'galaxie_wtw_runs_24h',
    'Execucoes do agente nas ultimas 24 h por status',
    Object.entries(m.runs24h).map(([status, n]) => [{ status }, n]),
  );
  gauge(
    lines,
    'galaxie_llm_tokens_today',
    'Tokens de LLM consumidos hoje (UTC) por agente',
    m.llmToday.map((r) => [{ agent: r.agent }, r.tokens]),
  );
  gauge(
    lines,
    'galaxie_llm_cost_usd_today',
    'Custo estimado de LLM hoje (UTC) por agente',
    m.llmToday.map((r) => [{ agent: r.agent }, r.costUsd]),
  );
  gauge(lines, 'galaxie_wtw_target', 'Metas de docs/07 secao 4', [
    [{ metric: 'coverage_t3h' }, WTW_TARGETS.coverageT3h],
    [{ metric: 'precision' }, WTW_TARGETS.precision],
    [{ metric: 'verification_t3h' }, WTW_TARGETS.verificationT3h],
    [{ metric: 'correction_propagation_seconds' }, WTW_TARGETS.correctionPropagationSec],
  ]);
  return `${lines.join('\n')}\n`;
}
