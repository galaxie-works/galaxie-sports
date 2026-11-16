/**
 * Chaves de runtime do cadastro em autoatendimento (plataforma comercial F2, doc 02 §Cadastro), resolvidas com a
 * precedência do painel (`ops.runtime_setting` > env > padrão do registro). Puro: a leitura do banco fica em
 * `settings-db.ts`. O cadastro só abre com `SIGNUP_ENABLED=on` E `SIGNUP_TERMS_VERSION` preenchida — a versão dos
 * termos aprovada pelo advogado (#1022) é a trava jurídica; sem ela a tela mostra "em breve".
 */
import { resolveSetting, settingDef } from '@galaxie/runtime-config';

export const SIGNUP_ENABLED_KEY = 'SIGNUP_ENABLED';
export const SIGNUP_TERMS_VERSION_KEY = 'SIGNUP_TERMS_VERSION';
export const SIGNUP_PER_IP_PER_DAY_KEY = 'SIGNUP_PER_IP_PER_DAY';
export const TRIAL_DAYS_KEY = 'TRIAL_DAYS';
export const SIGNUP_SETTING_KEYS = [
  SIGNUP_ENABLED_KEY,
  SIGNUP_TERMS_VERSION_KEY,
  SIGNUP_PER_IP_PER_DAY_KEY,
  TRIAL_DAYS_KEY,
] as const;

type Overrides = ReadonlyMap<string, string>;
type Env = Record<string, string | undefined>;

export interface SignupSettings {
  /** `SIGNUP_ENABLED=on`. */
  enabled: boolean;
  /** Versão dos termos aprovada; null = nenhuma (o cadastro não abre). */
  termsVersion: string | null;
  /** O cadastro público está aberto: ligado e com termos. */
  open: boolean;
  perIpPerDay: number;
  trialDays: number;
}

const effective = (key: string, overrides: Overrides, env: Env) =>
  resolveSetting(settingDef(key)!, { overrides, env: (k) => env[k] }).value;

const int = (value: string | null, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function resolveSignupSettings(overrides: Overrides, env: Env): SignupSettings {
  const enabled = (effective(SIGNUP_ENABLED_KEY, overrides, env) ?? 'off').toLowerCase() === 'on';
  const termsVersion = effective(SIGNUP_TERMS_VERSION_KEY, overrides, env)?.trim() || null;
  return {
    enabled,
    termsVersion,
    open: enabled && termsVersion !== null,
    perIpPerDay: int(effective(SIGNUP_PER_IP_PER_DAY_KEY, overrides, env), 5),
    trialDays: int(effective(TRIAL_DAYS_KEY, overrides, env), 30),
  };
}
