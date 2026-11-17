/**
 * Máquina de estados do tenant (plataforma comercial F3; doc 02 §Máquina de estados do tenant; brief
 * `.fila-merge/briefs/plataforma-f3.md`, decisões 1 a 3). Parte pura: a lista de estados, os que desligam tudo e a
 * tabela de transições do diagrama. Quem muda o estado é `transitionTenantState` (`transition.ts`).
 */
import {
  TENANT_STATES,
  TENANT_STATES_WITH_ACCESS,
  TENANT_STATES_WITH_WEBHOOKS,
  TENANT_STATES_WITHOUT_ACCESS,
  type TenantState,
} from '@galaxie/db/schema';

export { TENANT_STATES, TENANT_STATES_WITH_ACCESS, TENANT_STATES_WITH_WEBHOOKS, type TenantState };

/** Estados em que a API recusa toda chave e os direitos não têm módulo nenhum (decisão 3). */
export const STATES_WITHOUT_ACCESS: readonly TenantState[] = TENANT_STATES_WITHOUT_ACCESS;

/**
 * Para onde cada estado pode ir (diagrama do doc 02, mais o que o brief e a tabela das jornadas acrescentam):
 * - `draft → active` é a jornada assistida (contrato), que nasce ativa sem passar pelo trial;
 * - `trial → suspended` e `trial → cancelled` são as ações da equipe (decisão 7: suspender vale em trial, active e
 *   past_due; cancelar, em qualquer estado com acesso ou já suspenso);
 * - as transições de pagamento (`trial → active`, `trial_expired → active`, `active → past_due`, `past_due → active`,
 *   `suspended → active`) existem desde já; a F4 (Stripe) é quem as dispara.
 * `rejected` e `cancelled` são finais.
 */
export const TENANT_TRANSITIONS: Readonly<Record<TenantState, readonly TenantState[]>> = {
  draft: ['pending_review', 'trial', 'active'],
  pending_review: ['trial', 'rejected'],
  rejected: [],
  trial: ['active', 'trial_expired', 'suspended', 'cancelled'],
  trial_expired: ['active', 'cancelled'],
  active: ['past_due', 'suspended', 'cancelled'],
  past_due: ['active', 'suspended', 'cancelled'],
  suspended: ['active', 'cancelled'],
  cancelled: [],
};

export const isTenantState = (value: unknown): value is TenantState =>
  typeof value === 'string' && (TENANT_STATES as readonly string[]).includes(value);

/** A transição existe no diagrama? (`from === to` nunca é transição.) */
export function canTransition(from: TenantState, to: TenantState): boolean {
  return TENANT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** O estado dá acesso à API e aos widgets? (`past_due` passa como `active`.) */
export const stateHasAccess = (state: TenantState): boolean => TENANT_STATES_WITH_ACCESS.includes(state);
