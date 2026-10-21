/**
 * Painel de custo e qualidade da IA (docs/07 §4): `pnpm --filter @galaxie/ai-agents eval:report`.
 * Flags: --dias <n> (janela, padrão 7) · --json (saída para dashboards).
 */
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { computeAiMetrics, type Ratio } from '../evaluation/metrics.js';
import { dbFromEnv, intFlag } from './common.js';

const { values } = parseArgs({
  options: { dias: { type: 'string' }, json: { type: 'boolean', default: false } },
  strict: true,
});

const pct = (r: Ratio | number | null) => {
  const v = typeof r === 'number' || r === null ? r : r.value;
  return v === null ? 'n/d' : `${(v * 100).toFixed(1)}%`;
};

const db = dbFromEnv();
try {
  const days = intFlag(values.dias, 'dias') ?? 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const m = await computeAiMetrics(db, { from, to });
  if (values.json) {
    console.log(JSON.stringify(m, null, 2));
  } else {
    console.log(`Janela: ${m.window.from} → ${m.window.to}`);
    console.table(
      (['scenario', 'recap'] as const).map((k) => ({
        agente: k,
        textos: m.byKind[k].texts,
        eventos: m.byKind[k].events,
        'LLM 1ª': pct(m.byKind[k].llmFirstPass),
        'LLM 2ª': pct(m.byKind[k].llmRetryPass),
        fallback: pct(m.byKind[k].fallback),
        fidelidade: pct(m.byKind[k].fidelityValidator),
        barradas: Object.entries(m.byKind[k].blockedViolations)
          .map(([kind, n]) => `${kind}:${n}`)
          .join(' '),
      })),
    );
    console.log(
      `Custo: ${m.cost.llmCalls} chamada(s) · ${m.cost.inputTokens}+${m.cost.outputTokens} tokens · ` +
        `US$ ${m.cost.costUsd.toFixed(4)} · ${m.cost.eventsEnriched} evento(s) · ` +
        `US$ ${m.cost.costPerEventUsd === null ? 'n/d' : m.cost.costPerEventUsd.toFixed(4)}/evento`,
    );
    console.table(
      m.targets.map((t) => ({
        metrica: t.metric,
        valor: pct(t.value),
        meta: t.target,
        status: t.ok === null ? '—' : t.ok ? 'ok' : 'abaixo',
        nota: t.note ?? '',
      })),
    );
  }
} finally {
  await closeDb(db);
}
