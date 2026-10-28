import { PRIORITIES, type Priority } from '../types.js';

export interface QuotaPolicy {
  dailyLimit: number;
  /**
   * Reserva (% do limite diário). Com `liveUsesReserve` (produção), abaixo dela só o ao vivo chama; sem ele
   * (dev), ninguém passa dela: a conta é a mesma da produção, e a sobra é dela.
   */
  reservePercent: number;
  /** true na produção: LIVE pode gastar a reserva. false no dev: a reserva vale para todas as prioridades. */
  liveUsesReserve: boolean;
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

/** docs/03 §9 — DAILY 40%, LIVE 40%, ADHOC 5%; BOOTSTRAP vive da folga. */
export const DEFAULT_SHARES: Record<Priority, number> = { DAILY: 0.4, LIVE: 0.4, ADHOC: 0.05, BOOTSTRAP: 0 };

/** Produção: abaixo de 25% da cota diária, só o ao vivo chama (decisão de 28/10/2026). */
export const PRODUCTION_RESERVE_PERCENT = 25;
/**
 * Dev (NAS): a conta da api-sports é a mesma da produção, então o dev para quando a conta inteira (as duas
 * pontas somadas) chega a 30% do dia. É o mínimo: um valor menor na configuração não vale no dev.
 */
export const DEV_MIN_RESERVE_PERCENT = 70;

/** Política padrão (docs/03 §9). Os serviços montam a sua pelo ambiente (`quotaPolicyFromEnv`, em @galaxie/observability). */
export function defaultPolicy(
  dailyLimit: number,
  reservePercent = 15,
  perMinute?: number,
  liveUsesReserve = true,
): QuotaPolicy {
  return {
    dailyLimit,
    reservePercent,
    liveUsesReserve,
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
   * Contador do fornecedor + chamadas que fizemos depois da leitura. A leitura vem do /status (de hora em hora)
   * ou do header `x-ratelimit-requests-remaining` de cada resposta, e soma o consumo das duas pontas que usam a
   * conta (dev e produção). Usado como piso do total — o contador do fornecedor é eventualmente consistente.
   */
  providerUsed?: number;
  /** Limite diário informado pelo fornecedor (/status). Se menor que o da política, prevalece. */
  providerLimit?: number;
  /**
   * O fornecedor respondeu "cota do dia esgotada" há pouco (ver `exhaustedSince`): nega por um tempo,
   * inclusive o ao vivo, em vez de gastar uma tentativa a cada job. Não é piso do dia: expira sozinho.
   */
  providerExhausted?: boolean;
  /** Até quando (ms) a API está pausada por um limite por minuto do fornecedor (ver RATE_LIMIT_PAUSE_MS). */
  pausedUntil?: number;
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

/**
 * Depois de um 429 ou de um aviso de limite por minuto (`errors.rateLimit`), todas as chamadas daquela API
 * esperam este tempo (no processo, e em todos os processos do mesmo banco com o PgQuotaGovernor).
 */
export const RATE_LIMIT_PAUSE_MS = 30_000;

/**
 * O header de cota do dia só vira piso depois da carência do começo do dia (o contador do fornecedor ainda pode
 * responder pelo dia anterior) e se a resposta chegou no mesmo dia da reserva.
 */
export function headerFloorApplies(day: string, nowMs: number): boolean {
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  return nowMs >= dayStart + DAY_START_GRACE_MS && nowMs < dayStart + 86_400_000;
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
 * 1. Nunca ultrapassa limite − reserva; na produção, o ao vivo (LIVE) pode usar a reserva.
 * 2. Dentro da própria fatia, sempre pode.
 * 3. Fora dela, só usa a folga que sobra depois de proteger o saldo de DAILY e LIVE (do saldo de LIVE, na
 *    produção, só o que a reserva não cobre).
 */
export function decide(configured: QuotaPolicy, usage: UsageSnapshot, p: Priority): Decision {
  const policy = effectivePolicy(configured, usage);
  const sumUsed = PRIORITIES.reduce((acc, q) => acc + usage.used[q], 0);
  const totalUsed = Math.max(sumUsed, usage.providerUsed ?? 0);
  const usesReserve = p === 'LIVE' && policy.liveUsesReserve;
  const cap = policy.dailyLimit - (usesReserve ? 0 : reserveOf(policy));

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
      reason:
        policy.liveUsesReserve && !usesReserve
          ? `reserva do ao vivo: só LIVE passa de ${cap} (${totalUsed}/${policy.dailyLimit})`
          : `limite diário atingido (${totalUsed}/${cap})`,
      totalUsed,
      cap,
    };
  }
  if (usage.used[p] < budgetFor(policy, usage, p)) {
    return { allow: true, borrowed: false, reason: 'dentro da fatia da prioridade', totalUsed, cap };
  }
  const protectedLeft = policy.protectedPriorities
    .filter((q) => q !== p)
    .reduce((acc, q) => {
      const left = Math.max(0, budgetFor(policy, usage, q) - usage.used[q]);
      // na produção a reserva inteira já é do ao vivo: abaixo do teto dos outros, só se protege o que passar dela
      return acc + (q === 'LIVE' && policy.liveUsesReserve ? Math.max(0, left - reserveOf(policy)) : left);
    }, 0);
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
