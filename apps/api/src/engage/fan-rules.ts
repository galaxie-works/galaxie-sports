/**
 * O que cada faixa etária pode fazer (D1 da revisão dos épicos; #937). Regra da base, igual nos cinco módulos:
 *
 * - `under13`: não entra em nenhum recurso social. Recebe token só para o cliente saber a resposta;
 * - `13_17`: lê, palpita, vota, joga trivia, ganha pontos e conquistas. Não escreve texto livre e não resgata;
 * - `18plus`: tudo.
 *
 * O Prêmio vai para o Titular da Conta, não para o Perfil: sem `holder_adult = yes` ele fica pendente com o
 * cliente (#1017, D3).
 */
import type { FanAgeBand } from '@galaxie/db';

export const FAN_CAPABILITIES = ['read', 'predict', 'write', 'redeem'] as const;
export type FanCapability = (typeof FAN_CAPABILITIES)[number];

const MATRIX: Record<FanAgeBand, readonly FanCapability[]> = {
  under13: [],
  '13_17': ['read', 'predict'],
  '18plus': ['read', 'predict', 'write', 'redeem'],
};

export function fanCan(ageBand: FanAgeBand, capability: FanCapability): boolean {
  return MATRIX[ageBand].includes(capability);
}

/** Capacidades da faixa, na ordem de FAN_CAPABILITIES (vai no GET /v1/fans/me para o widget esconder botões). */
export function fanCapabilities(ageBand: FanAgeBand): FanCapability[] {
  return FAN_CAPABILITIES.filter((c) => fanCan(ageBand, c));
}
