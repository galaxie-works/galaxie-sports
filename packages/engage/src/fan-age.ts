/**
 * Estado de idade do torcedor (#1105, épico #1103): o que falta para o Perfil usar os recursos sociais, a partir da
 * faixa fina, da comprovação e da autorização do responsável que o cliente manda no token, contra a ficha do país.
 * Vai no `GET /v1/fans/me` e no widget; o portão único de todos os módulos é a Idade 3 (#1106).
 */
import {
  AGE_ASSURANCE_LEVELS,
  ageBandFloor,
  assuranceAtLeast,
  type AgeAssuranceLevel,
  type AgeBand,
  type CountryPolicy,
} from './country-policy.js';

/** Faixas finas aceitas no token; `13_17` (a larga, de antes do #1105) entra como `13`. */
export const FAN_AGE_BANDS_DETAIL = ['under13', '13', '14_15', '16_17', '18plus'] as const;
export type FanAgeBandDetail = (typeof FAN_AGE_BANDS_DETAIL)[number];

/** Faixa fina do que o cliente mandou: a larga `13_17` vira `13`, a mais restritiva. */
export const detailAgeBand = (band: FanAgeBandDetail | '13_17'): FanAgeBandDetail =>
  band === '13_17' ? '13' : band;

export const FAN_GUARDIAN_STATUSES = ['none', 'pending', 'granted', 'revoked'] as const;
export type FanGuardianStatus = (typeof FAN_GUARDIAN_STATUSES)[number];

/**
 * - `blocked`: abaixo da idade para participar (menor de 13, ou a ficha pede mais);
 * - `needs_guardian`: falta a autorização do responsável ou o vínculo com a conta dele;
 * - `needs_verification`: a comprovação de idade está abaixo da que a ficha pede para os recursos sociais;
 * - `read_only`: participa, mas não escreve texto livre (ou a faixa está congelada depois de descer);
 * - `can_write`: participa e escreve.
 */
export const FAN_AGE_STATUSES = [
  'blocked',
  'needs_guardian',
  'needs_verification',
  'read_only',
  'can_write',
] as const;
export type FanAgeStatus = (typeof FAN_AGE_STATUSES)[number];

export interface FanAgeFacts {
  band: AgeBand;
  assurance: AgeAssuranceLevel;
  guardianStatus: FanGuardianStatus;
  guardianLinked: boolean;
  /** A faixa desceu de `18plus` e está congelada até a correção (#1110). */
  frozen: boolean;
}

/**
 * Estado do Perfil contra a ficha do país. Sem ficha (país sem ficha e sem DEFAULT nem país principal), só o
 * `18plus` participa, e só lendo: a ficha que falta nunca libera um menor.
 */
export function fanAgeStatus(facts: FanAgeFacts, policy: CountryPolicy | null): FanAgeStatus {
  const floor = ageBandFloor(facts.band);
  if (!policy) return floor >= 18 ? 'read_only' : 'blocked';
  if (floor < policy.minAgeParticipate) return 'blocked';
  if (floor < policy.parentalConsentUnder && facts.guardianStatus !== 'granted') return 'needs_guardian';
  if (
    policy.guardianLinkRequiredUnder !== null &&
    floor < policy.guardianLinkRequiredUnder &&
    !facts.guardianLinked
  )
    return 'needs_guardian';
  if (!assuranceAtLeast(facts.assurance, policy.ageAssuranceMin.social)) return 'needs_verification';
  if (facts.frozen) return 'read_only';
  // só 18+ escreve, mesmo que a ficha baixe a idade (regra fixa da Galaxie, a mesma do portão, #1106)
  return floor >= Math.max(18, policy.minAgeWrite) ? 'can_write' : 'read_only';
}

export const isAgeAssuranceLevel = (v: unknown): v is AgeAssuranceLevel =>
  (AGE_ASSURANCE_LEVELS as readonly unknown[]).includes(v);
