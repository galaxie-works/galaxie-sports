import { PRIORITIES, type Priority } from '../types.js';

export interface QuotaPolicy {
  dailyLimit: number;
  /** Reserva de segurança (% do limite diário); só LIVE crítico pode usá-la. */
  reservePercent: number;
  /** Fatia padrão de cada prioridade (fração do limite diário) quando não há plano do dia em ops.quota_budget. */
  shares: Record<Priority, number>;
  /** Prioridades cujo saldo não pode ser emprestado por outras. */
  protectedPriorities: Priority[];
}

/** docs/03 §9 — free: DAILY 40%, LIVE 40%, ADHOC 5%, reserva 15%; BOOTSTRAP vive da folga. */
export const DEFAULT_SHARES: Record<Priority, number> = { DAILY: 0.4, LIVE: 0.4, ADHOC: 0.05, BOOTSTRAP: 0 };

export function defaultPolicy(dailyLimit: number, reservePercent = 15): QuotaPolicy {
  return { dailyLimit, reservePercent, shares: DEFAULT_SHARES, protectedPriorities: ['DAILY', 'LIVE'] };
}

export interface UsageSnapshot {
  /** Chamadas já enviadas (ou reservadas) hoje, por prioridade, segundo o nosso ledger. */
  used: Record<Priority, number>;
  /** Orçamento planejado para o dia (ops.quota_budget), sobrescreve as fatias padrão. */
  planned?: Partial<Record<Priority, number>>;
  /**
   * Contador do fornecedor (via /status) + chamadas que fizemos depois da leitura.
   * Usado como piso do total — o contador do fornecedor é eventualmente consistente.
   */
  providerUsed?: number;
}

export interface Decision {
  allow: boolean;
  /** true quando a chamada usa folga de outra prioridade. */
  borrowed: boolean;
  reason: string;
  totalUsed: number;
  cap: number;
}

export function emptyUsage(): Record<Priority, number> {
  return Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
}

export function budgetFor(policy: QuotaPolicy, usage: UsageSnapshot, p: Priority): number {
  return usage.planned?.[p] ?? Math.floor(policy.dailyLimit * policy.shares[p]);
}

export function reserveOf(policy: QuotaPolicy): number {
  return Math.ceil((policy.dailyLimit * policy.reservePercent) / 100);
}

/**
 * Decide se uma chamada da prioridade `p` pode sair agora.
 * 1. Nunca ultrapassa limite − reserva (LIVE crítico pode usar a reserva).
 * 2. Dentro da própria fatia, sempre pode.
 * 3. Fora dela, só usa a folga que sobra depois de proteger o saldo de DAILY e LIVE.
 */
export function decide(
  policy: QuotaPolicy,
  usage: UsageSnapshot,
  p: Priority,
  opts: { critical?: boolean } = {},
): Decision {
  const sumUsed = PRIORITIES.reduce((acc, q) => acc + usage.used[q], 0);
  const totalUsed = Math.max(sumUsed, usage.providerUsed ?? 0);
  const cap = policy.dailyLimit - (p === 'LIVE' && opts.critical ? 0 : reserveOf(policy));

  if (totalUsed >= cap) {
    return {
      allow: false,
      borrowed: false,
      reason: `limite diário atingido (${totalUsed}/${cap})`,
      totalUsed,
      cap,
    };
  }
  if (usage.used[p] < budgetFor(policy, usage, p)) {
    return { allow: true, borrowed: false, reason: 'dentro da fatia da prioridade', totalUsed, cap };
  }
  const protectedLeft = policy.protectedPriorities
    .filter((q) => q !== p)
    .reduce((acc, q) => acc + Math.max(0, budgetFor(policy, usage, q) - usage.used[q]), 0);
  const slack = cap - totalUsed - protectedLeft;
  if (slack > 0) {
    return { allow: true, borrowed: true, reason: `folga disponível (${slack})`, totalUsed, cap };
  }
  return {
    allow: false,
    borrowed: false,
    reason: `fatia de ${p} esgotada e sem folga (saldo protegido: ${protectedLeft})`,
    totalUsed,
    cap,
  };
}
