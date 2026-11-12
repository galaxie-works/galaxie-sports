/**
 * Portão de idade único (#1106, épico #1103): para um torcedor e um recurso, responde se pode, e se não pode, o
 * motivo e o que falta antes. Chat, Comunidades, Gamificação, Shop the game e Cosmos chamam esta função no servidor;
 * nenhum módulo decide idade sozinho. Um módulo pode endurecer depois do portão, nunca liberar o que ele negou.
 *
 * Regras fixas da Galaxie, que nenhuma ficha afrouxa:
 * - menor de 13 fica fora de tudo que é social (e a ficha pode subir esse piso com `minAgeParticipate`);
 * - só 18+ escreve texto livre (`minAgeWrite`, nunca abaixo de 18), resgata, usa marketplace, recebe Prêmio (D1 do
 *   #1017), recebe contato direto e vê conteúdo restrito;
 * - faixa congelada depois de descer de `18plus` (#1105) vale como menor até a correção.
 *
 * Regras da ficha do país: abaixo de `parentalConsentUnder`, só com a autorização do responsável; abaixo de
 * `guardianLinkRequiredUnder`, só com a conta vinculada à dele; comprovação abaixo de `ageAssuranceMin` pede outra.
 */
import {
  ageBandFloor,
  assuranceAtLeast,
  type AgeAssuranceFeature,
  type CountryPolicy,
} from './country-policy.js';
import type { FanAgeFacts } from './fan-age.js';

export const AGE_CAPABILITIES = [
  'read',
  'react',
  'predict',
  'earnPoints',
  'write',
  'redeem',
  'marketplace',
  'receivePrize',
  'receiveMarketing',
  'viewRestrictedContent',
  'directContact',
  'safety',
] as const;
export type AgeCapability = (typeof AGE_CAPABILITIES)[number];

export const isAgeCapability = (v: unknown): v is AgeCapability =>
  (AGE_CAPABILITIES as readonly unknown[]).includes(v);

/** Só para quem tem 18 anos ou mais, em qualquer ficha. */
export const ADULT_ONLY_CAPABILITIES: readonly AgeCapability[] = [
  'write',
  'redeem',
  'marketplace',
  'receivePrize',
  'viewRestrictedContent',
  'directContact',
];

/**
 * - `no_policy`: o país não tem ficha (nem DEFAULT nem país principal); só o adulto lê;
 * - `under_min_age`: abaixo da idade para participar;
 * - `adult_only`: o recurso é só para 18+;
 * - `frozen`: a faixa desceu de `18plus` e vale como menor até a correção;
 * - `guardian_consent`: falta a autorização do responsável;
 * - `guardian_link`: falta vincular a conta à do responsável;
 * - `age_assurance`: a comprovação de idade está abaixo da que a ficha pede para o recurso;
 * - `not_in_country`: a ficha do país não libera o recurso (marketplace desligado, publicidade para menores).
 */
export const AGE_GATE_REASONS = [
  'ok',
  'no_policy',
  'under_min_age',
  'adult_only',
  'frozen',
  'guardian_consent',
  'guardian_link',
  'age_assurance',
  'not_in_country',
] as const;
export type AgeGateReason = (typeof AGE_GATE_REASONS)[number];

/** O que o cliente pode fazer para liberar: comprovar a idade, pedir a autorização ou vincular a conta. */
export const AGE_GATE_NEXT = ['verify_age', 'guardian_consent', 'guardian_link'] as const;
export type AgeGateNext = (typeof AGE_GATE_NEXT)[number];

export interface AgeGateResult {
  allowed: boolean;
  reason: AgeGateReason;
  next?: AgeGateNext;
}

export interface AgeGateInput {
  /** Ficha já resolvida para o país do token (`resolvePolicy`); null quando não há nenhuma. */
  policy: CountryPolicy | null;
  fan: FanAgeFacts;
  capability: AgeCapability;
}

const ADULT = 18;
const GALAXIE_MIN_PARTICIPATE = 13;

const deny = (reason: Exclude<AgeGateReason, 'ok'>, next?: AgeGateNext): AgeGateResult =>
  next ? { allowed: false, reason, next } : { allowed: false, reason };

/**
 * `safety`: denunciar, bloquear, ver as próprias punições e apelar. Proteção e direito de defesa não dependem da
 * autorização do responsável nem da comprovação: só ficam fora os abaixo da idade para participar.
 */
const SAFETY: AgeCapability = 'safety';

const assuranceFeature = (c: AgeCapability): AgeAssuranceFeature =>
  c === 'viewRestrictedContent' ? 'restrictedContent' : 'social';

/** O portão. Pura: a mesma entrada dá sempre a mesma resposta; quem chama lê a ficha e o Perfil frescos. */
export function ageGate({ policy, fan, capability }: AgeGateInput): AgeGateResult {
  const floor = ageBandFloor(fan.band);
  if (capability === SAFETY)
    return floor >= Math.max(GALAXIE_MIN_PARTICIPATE, policy?.minAgeParticipate ?? 0)
      ? { allowed: true, reason: 'ok' }
      : deny('under_min_age');
  // sem ficha, nada protege o menor: só o adulto, e só lendo (o mesmo `read_only` do `age_status`)
  if (!policy)
    return floor >= ADULT && capability === 'read' ? { allowed: true, reason: 'ok' } : deny('no_policy');
  if (floor < Math.max(GALAXIE_MIN_PARTICIPATE, policy.minAgeParticipate)) return deny('under_min_age');

  if (ADULT_ONLY_CAPABILITIES.includes(capability)) {
    // uma ficha que pede mais de 18 para escrever recusa todo mundo: a faixa `18plus` não prova 21
    const min = capability === 'write' ? Math.max(ADULT, policy.minAgeWrite) : ADULT;
    // congelada: a faixa gravada já é a de menor, mas o caminho é comprovar a idade (#1110), não esperar
    if (fan.frozen) return deny('frozen', 'verify_age');
    if (floor < min) return deny('adult_only');
  }

  if (floor < policy.parentalConsentUnder && fan.guardianStatus !== 'granted')
    return deny('guardian_consent', 'guardian_consent');
  if (
    policy.guardianLinkRequiredUnder !== null &&
    floor < policy.guardianLinkRequiredUnder &&
    !fan.guardianLinked
  )
    return deny('guardian_link', 'guardian_link');
  if (!assuranceAtLeast(fan.assurance, policy.ageAssuranceMin[assuranceFeature(capability)]))
    return deny('age_assurance', 'verify_age');

  if (capability === 'marketplace' && !policy.gamification.marketplace) return deny('not_in_country');
  if (capability === 'receiveMarketing' && (floor < ADULT || fan.frozen) && !policy.adsToMinors)
    return deny('not_in_country');
  return { allowed: true, reason: 'ok' };
}
