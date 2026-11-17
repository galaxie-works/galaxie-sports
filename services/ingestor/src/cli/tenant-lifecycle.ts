/**
 * Relógio da máquina de estados do tenant (job `tenant-lifecycle`, plataforma comercial F3): a mesma rodada da tarefa
 * `tenant.lifecycle` da fila, direto no banco (QUEUE_MODE=run, ou um ensaio na mão). Não apaga nada.
 *   pnpm --filter @galaxie/ingestor tenant:lifecycle [--agora 2026-11-16T04:15:00Z]
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { pgLifecycleDeps, runTenantLifecycle } from '../tasks/lifecycle.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { agora: { type: 'string' } }, strict: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const now = values.agora ? new Date(values.agora) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('--agora precisa ser uma data ISO 8601.');
  const db = createDb(url, { max: 2, applicationName: 'galaxie-tenant-lifecycle' });
  try {
    const r = await runTenantLifecycle(db, pgLifecycleDeps, now);
    report('Ciclo de vida dos tenants', [
      {
        referência: r.now,
        prazos: `trial_expired ${r.settings.trialExpiredDays} d · past_due ${r.settings.pastDueDays} d · suspended ${r.settings.suspendedDays} d · guarda ${r.settings.cancelledRetentionDays} d`,
        examinados: r.examined,
        transições: r.transitions.map((t) => `${t.tenant}: ${t.from} → ${t.to}`).join('; ') || '—',
        recusadas: r.refused.map((x) => `${x.tenant}: ${x.error}`).join('; ') || '—',
        'guarda vencida (nada apagado)': r.retentionExpired.join(', ') || '—',
        'domínios de volta à conferência': r.domainsRechecked,
        'e-mails': `${r.notifications.sent.length} enviados · ${r.notifications.registered.length} registrados sem entrega · ${r.notifications.failed.length} com falha`,
      },
    ]);
  } finally {
    await closeDb(db);
  }
});
