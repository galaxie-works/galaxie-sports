import {
  buildReport,
  emptyUsage,
  PRIORITIES,
  type Priority,
  type QuotaPolicy,
  type UsageReport,
  type UsageSnapshot,
} from '@galaxie/apisports-client';
import type { BudgetRow, LedgerCountRow, ProviderSnapshotRow } from './queries.js';

export interface QuotaState extends UsageReport {
  /** Uso efetivo do dia: o maior entre o nosso ledger e o contador do fornecedor (mesma regra do Governor). */
  effectiveUsed: number;
  remaining: number;
  /** remaining / dailyLimit (0..1). */
  remainingRatio: number;
}

/**
 * Converte as linhas do banco no relatório de cota de cada API, reaproveitando a política do Quota Governor
 * (`buildReport`) — o painel mostra exatamente o que o Governor usa para decidir.
 */
export function computeQuotaStates(
  apis: readonly string[],
  dayUtc: string,
  policyFor: (api: string) => QuotaPolicy,
  ledger: readonly LedgerCountRow[],
  snapshots: readonly ProviderSnapshotRow[],
  budgets: readonly BudgetRow[],
): QuotaState[] {
  return apis.map((api) => {
    const used = emptyUsage();
    for (const row of ledger) {
      if (row.api === api && row.dayUtc === dayUtc && isPriority(row.priority))
        used[row.priority] += row.calls;
    }
    const planRows = budgets.filter((b) => b.api === api && isPriority(b.priority));
    const snap = snapshots.find((s) => s.api === api);
    const usage: UsageSnapshot = {
      used,
      ...(planRows.length
        ? {
            planned: Object.fromEntries(planRows.map((b) => [b.priority, b.planned])) as Partial<
              Record<Priority, number>
            >,
          }
        : {}),
      ...(snap ? { providerUsed: snap.providerUsed, providerLimit: snap.providerLimit } : {}),
    };
    const report = buildReport(policyFor(api), api, dayUtc, usage);
    const effectiveUsed = Math.max(report.totalUsed, report.providerUsed ?? 0);
    const remaining = Math.max(0, report.dailyLimit - effectiveUsed);
    return {
      ...report,
      effectiveUsed,
      remaining,
      remainingRatio: report.dailyLimit > 0 ? remaining / report.dailyLimit : 0,
    };
  });
}

function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}
