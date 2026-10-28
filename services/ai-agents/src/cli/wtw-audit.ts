/**
 * Onde assistir — auditoria amostral e métricas (issue #52).
 *   pnpm --filter @galaxie/ai-agents wtw:audit --amostrar [--data 2026-10-21] [--tamanho 20]
 *   pnpm --filter @galaxie/ai-agents wtw:audit --listar
 *   pnpm --filter @galaxie/ai-agents wtw:audit --marcar <auditId> --veredito correto|incorreto|incerto --revisor <handle> [--nota "..."]
 *   pnpm --filter @galaxie/ai-agents wtw:audit --metricas [--dias 30] [--prometheus]
 */
import { parseArgs } from 'node:util';
import { ledgerSettingsFromEnv } from '@galaxie/ai-ledger';
import { closeDb, createDb } from '@galaxie/db';
import { budgetDayOf } from '@galaxie/runtime-config';
import {
  computeWtwMetrics,
  listPendingAudits,
  recordVerdict,
  renderPrometheus,
  sampleForAudit,
  WTW_TARGETS,
  type AuditVerdict,
} from '@galaxie/where-to-watch';
import { activeMarkets } from '../wtw/markets.js';
import { runtimeEnv } from './common.js';

const VERDICTS: Record<string, AuditVerdict> = {
  correto: 'correct',
  incorreto: 'incorrect',
  incerto: 'unsure',
};
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      amostrar: { type: 'boolean', default: false },
      data: { type: 'string' },
      tamanho: { type: 'string' },
      listar: { type: 'boolean', default: false },
      marcar: { type: 'string' },
      veredito: { type: 'string' },
      revisor: { type: 'string' },
      nota: { type: 'string' },
      metricas: { type: 'boolean', default: false },
      dias: { type: 'string' },
      prometheus: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida.');
  const db = createDb(url, { max: 2 });
  try {
    if (values.amostrar) {
      const date = values.data ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--data no formato AAAA-MM-DD.');
      const r = await sampleForAudit(db, {
        date,
        ...(values.tamanho ? { size: Number(values.tamanho) } : {}),
      });
      console.log(
        `Amostra de ${date}: ${r.sampled} opção(ões) na fila (${r.lowConfidence} por confiança 0,70–0,75).`,
      );
    }
    if (values.marcar) {
      const verdict = VERDICTS[values.veredito ?? ''];
      if (!verdict) throw new Error('--veredito correto|incorreto|incerto');
      if (!values.revisor) throw new Error('--revisor <handle> obrigatório (handle interno, sem e-mail).');
      await recordVerdict(db, values.marcar, {
        verdict,
        reviewer: values.revisor,
        note: values.nota ?? null,
      });
      console.log(`Amostra ${values.marcar}: ${values.veredito}.`);
      if (verdict === 'incorrect')
        console.log(
          'Corrija a opção pela rota interna (POST/PATCH/DELETE /internal/where-to-watch) informando reported_at.',
        );
    }
    if (values.listar) {
      const rows = await listPendingAudits(db);
      if (!rows.length) console.log('Fila de auditoria vazia.');
      else
        console.table(
          rows.map((r) => ({
            amostra: r.auditId,
            dia: r.sampleDate,
            motivo: r.reason,
            evento: r.eventId,
            pais: r.country,
            emissora: r.provider + (r.channel ? ` (${r.channel})` : ''),
            regiao: r.region ?? 'nacional',
            confianca: r.confidence,
            fonte: r.sources[0] ?? '',
          })),
        );
    }
    if (values.metricas) {
      const m = await computeWtwMetrics(db, {
        countries: await activeMarkets(db),
        ...(values.dias ? { days: Number(values.dias) } : {}),
        // gasto de IA no dia de orçamento dos tetos (virada do painel, padrão 06:00 em Brasília)
        budgetDay: budgetDayOf(new Date(), ledgerSettingsFromEnv(await runtimeEnv(db)).budgetDay),
      });
      if (values.prometheus) {
        process.stdout.write(renderPrometheus(m));
        return;
      }
      console.log(
        `Onde assistir — últimos ${m.windowDays} dias (mercados: ${m.countries.join(', ') || 'nenhum'})`,
      );
      console.table([
        {
          metrica: 'Cobertura até T-3h (tier 1)',
          valor: pct(m.coverage.ratio),
          meta: pct(WTW_TARGETS.coverageT3h),
          base: m.coverage.pairs,
        },
        {
          metrica: 'Verificação em T-3h (tier 1)',
          valor: pct(m.coverage.verifiedRatio),
          meta: pct(WTW_TARGETS.verificationT3h),
          base: m.coverage.pairs,
        },
        {
          metrica: 'Precisão auditada',
          valor: pct(m.precision.ratio),
          meta: pct(WTW_TARGETS.precision),
          base: m.precision.correct + m.precision.incorrect,
        },
        {
          metrica: 'Tempo de correção (p50, s)',
          valor: m.correction.p50Sec ?? '—',
          meta: '—',
          base: m.correction.count,
        },
        { metrica: 'Auditorias pendentes', valor: m.auditPending, meta: '—', base: '' },
      ]);
      console.log('Opções vigentes:', m.options, '· execuções 24 h:', m.runs24h, '· LLM hoje:', m.llmToday);
    }
    if (!values.amostrar && !values.marcar && !values.listar && !values.metricas)
      console.log('Use --amostrar, --listar, --marcar <id> ou --metricas (ver cabeçalho do arquivo).');
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
