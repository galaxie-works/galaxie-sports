/**
 * Precedência entre provedores que descrevem o mesmo evento (issue #23).
 *
 * Regra: a lista de precedência vai do mais confiável ao menos confiável (ex.: provedor licenciado
 * do cliente, depois api-sports). Um provedor só sobrescreve o estado (status, placar, relógio)
 * escrito por outro quando:
 * 1. ninguém escreveu ainda, ou foi ele mesmo;
 * 2. ele tem precedência igual ou maior; ou
 * 3. o dono atual está sem dado fresco (`is_stale` ou última atualização mais antiga que `staleAfterMs`).
 * Provedores fora da lista ficam abaixo de todos os listados.
 */
export interface PrecedencePolicy {
  /** IDs de provedores, do mais confiável ao menos confiável. */
  order: readonly string[];
  /** Depois disso sem dado novo, um provedor de menor precedência pode assumir. Padrão: 10 min. */
  staleAfterMs?: number;
}

export const DEFAULT_PRECEDENCE: PrecedencePolicy = { order: ['api-sports'], staleAfterMs: 10 * 60_000 };

export interface CurrentOwner {
  provider: string | null;
  lastValidAt: Date | null;
  isStale: boolean;
}

export function providerRank(policy: PrecedencePolicy, provider: string): number {
  const i = policy.order.indexOf(provider);
  return i === -1 ? policy.order.length : i;
}

/** O provedor `incoming`, observando em `at`, pode sobrescrever o estado do evento? */
export function canOverride(
  policy: PrecedencePolicy,
  current: CurrentOwner,
  incoming: string,
  at: Date,
): boolean {
  if (current.provider == null || current.provider === incoming) return true;
  if (providerRank(policy, incoming) <= providerRank(policy, current.provider)) return true;
  if (current.isStale || current.lastValidAt == null) return true;
  const staleAfter = policy.staleAfterMs ?? 10 * 60_000;
  return at.getTime() - current.lastValidAt.getTime() > staleAfter;
}
