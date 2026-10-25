import { PRIORITIES, type Priority } from '../types.js';

export interface QuotaPolicy {
  dailyLimit: number;
  /** Reserva de segurança (% do limite diário); só LIVE crítico pode usá-la. */
  reservePercent: number;
  /** Fatia padrão de cada prioridade (fração do limite diário) quando não há plano do dia em ops.quota_budget. */
  shares: Record<Priority, number>;
  /** Prioridades cujo saldo não pode ser emprestado por outras. */
  protectedPriorities: Priority[];
  /**
   * Limite por minuto da API somando todos os processos que usam a chave (o scheduler roda cada job num
   * processo filho). Aplicado pelo PgQuotaGovernor; sem ele, vale só o RateLimiter local de cada processo.
   */
  perMinute?: number | undefined;
}

/** docs/03 §9 — free: DAILY 40%, LIVE 40%, ADHOC 5%, reserva 15%; BOOTSTRAP vive da folga. */
export const DEFAULT_SHARES: Record<Priority, number> = { DAILY: 0.4, LIVE: 0.4, ADHOC: 0.05, BOOTSTRAP: 0 };

export function defaultPolicy(dailyLimit: number, reservePercent = 15, perMinute?: number): QuotaPolicy {
  return {
    dailyLimit,
    reservePercent,
    shares: DEFAULT_SHARES,
    protectedPriorities: ['DAILY', 'LIVE'],
    ...(perMinute !== undefined ? { perMinute } : {}),
  };
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
  /** Limite diário informado pelo fornecedor (/status). Se menor que o da política, prevalece. */
  providerLimit?: number;
  /**
   * O fornecedor respondeu "cota do dia esgotada" há pouco (ver `exhaustedSince`): nega por um tempo,
   * inclusive LIVE crítico, em vez de gastar uma tentativa a cada job. Não é piso do dia: expira sozinho.
   */
  providerExhausted?: boolean;
}

/** Depois de uma resposta quota_exhausted, a API fica negada por este tempo (uma nova tentativa a cada janela). */
export const EXHAUSTED_COOLDOWN_MS = 15 * 60_000;
/**
 * Nos primeiros minutos do dia UTC o contador do fornecedor (eventualmente consistente) ainda pode responder
 * "esgotada" pelo dia anterior: essas respostas não bloqueiam o dia novo.
 */
export const DAY_START_GRACE_MS = 5 * 60_000;

/**
 * Instante a partir do qual um quota_exhausted enviado no dia `day` (o dia da reserva) ainda bloqueia:
 * os últimos EXHAUSTED_COOLDOWN_MS, nunca antes do fim da carência do começo do dia.
 */
export function exhaustedSince(day: string, nowMs: number): number {
  return Math.max(nowMs - EXHAUSTED_COOLDOWN_MS, Date.parse(`${day}T00:00:00Z`) + DAY_START_GRACE_MS);
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

/**
 * Política efetiva: se o fornecedor informa um limite menor que o configurado (ex.: Pro expirou e voltou
 * ao free), as fatias e a reserva passam a ser calculadas sobre o limite do fornecedor.
 */
export function effectivePolicy(policy: QuotaPolicy, usage: UsageSnapshot): QuotaPolicy {
  const limit = usage.providerLimit;
  return limit !== undefined && limit > 0 && limit < policy.dailyLimit
    ? { ...policy, dailyLimit: limit }
    : policy;
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
  configured: QuotaPolicy,
  usage: UsageSnapshot,
  p: Priority,
  opts: { critical?: boolean } = {},
): Decision {
  const policy = effectivePolicy(configured, usage);
  const sumUsed = PRIORITIES.reduce((acc, q) => acc + usage.used[q], 0);
  const totalUsed = Math.max(sumUsed, usage.providerUsed ?? 0);
  const cap = policy.dailyLimit - (p === 'LIVE' && opts.critical ? 0 : reserveOf(policy));

  if (usage.providerExhausted) {
    return {
      allow: false,
      borrowed: false,
      reason: `o fornecedor informou cota do dia esgotada (nova tentativa em até ${EXHAUSTED_COOLDOWN_MS / 60_000} min)`,
      totalUsed,
      cap,
    };
  }
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
