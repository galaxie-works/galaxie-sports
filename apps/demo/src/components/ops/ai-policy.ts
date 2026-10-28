import { settingDef } from '@galaxie/runtime-config';

/** Chaves do cartão Política de IA (gravadas e voltadas ao padrão juntas). */
export const AI_POLICY_KEYS = ['AI_BAND_SHARES', 'AI_DAILY_USD_BUDGET', 'AI_P0_MIN_AUDIENCE'] as const;
export type AiPolicyKey = (typeof AI_POLICY_KEYS)[number];

/**
 * Pedir confirmação antes de gravar ou voltar ao padrão: o mesmo critério das flags do painel (chave
 * `critical` no registro: custo ou cobertura). As três chaves do cartão são críticas.
 */
export function needsConfirmation(keys: readonly string[]): boolean {
  return keys.some((key) => settingDef(key)?.critical === true);
}
