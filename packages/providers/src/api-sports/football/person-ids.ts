/**
 * Técnicos e jogadores têm espaços de ids separados na api-sports (o técnico 123 e o jogador 123 são pessoas
 * diferentes). No core (`core.provider_map`, entity_type `person`) o técnico leva o prefixo `coach:`.
 */
export const COACH_ID_PREFIX = 'coach:';

/** Id do técnico no core a partir do id da api-sports. */
export function coachPersonId(id: string | number): string {
  return `${COACH_ID_PREFIX}${id}`;
}

export function isCoachPersonId(providerId: string): boolean {
  return providerId.startsWith(COACH_ID_PREFIX);
}

/** Id da api-sports (sem o prefixo) de uma pessoa do core. */
export function apiSportsPersonId(providerId: string): string {
  return isCoachPersonId(providerId) ? providerId.slice(COACH_ID_PREFIX.length) : providerId;
}
