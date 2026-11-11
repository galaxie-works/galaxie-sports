/**
 * Configuração do "Sugerir ou reportar algo" (só no servidor): liga/desliga, repo e token, com a precedência do painel
 * (ops.runtime_setting) sobre o env do contêiner. Aqui fica a parte sem banco; a leitura está em settings-db.ts.
 *
 * O token do painel é só-escrita e cifrado pelo mecanismo geral das chaves do painel (#1087): `SettingsSecretBox`, com a
 * `SETTINGS_KEK` fora do banco, na linha `FEEDBACK_GITHUB_TOKEN_SEALED`. Só a demo lê essa chave, então ela nunca entra
 * no env dos jobs; o histórico registra quem trocou e quando, nunca o valor. O token gravado antes (cifrado com a KEK dos
 * webhooks, `WEBHOOK_SIGNING_SECRET`) continua abrindo pelo cofre até ser recifrado.
 */
import { resolveSetting, sealedKey, settingDef, type SealedSecretOpener } from '@galaxie/runtime-config';
import type { SettingsSecretBox } from '@galaxie/runtime-config/sealed';

import { feedbackGithubConfig, type FeedbackGithubConfig } from './github';

export const FEEDBACK_ENABLED_KEY = 'FEEDBACK_ENABLED';
export const FEEDBACK_REPO_KEY = 'FEEDBACK_GITHUB_REPO';
const FEEDBACK_TOKEN_ENV = 'FEEDBACK_GITHUB_TOKEN';
export const FEEDBACK_SEALED_TOKEN_KEY = sealedKey(FEEDBACK_TOKEN_ENV);
export const FEEDBACK_SETTING_KEYS = [
  FEEDBACK_ENABLED_KEY,
  FEEDBACK_REPO_KEY,
  FEEDBACK_SEALED_TOKEN_KEY,
] as const;

/** Só ASCII visível: o token vira cabeçalho HTTP. O formato exato quem confere é o GitHub. */
const TOKEN_RE = /^[\x21-\x7e]{20,512}$/;

type Overrides = ReadonlyMap<string, string>;
type Env = Record<string, string | undefined>;

export interface FeedbackSettings {
  enabled: boolean;
  /** Token efetivo: o do painel e, se não houver ou não abrir, o do env. */
  token: string | null;
  repo: string | null;
  /** O que o envio usa; null = falta token ou repo. */
  config: FeedbackGithubConfig | null;
  /** Há token no painel, mas ele não abre (KEK ausente ou trocada, dado alterado, texto puro). */
  tokenUnreadable: boolean;
  tokenInPanel: boolean;
}

const effective = (key: string, overrides: Overrides, env: Env) =>
  resolveSetting(settingDef(key)!, { overrides, env: (k) => env[k] }).value;

export const isValidFeedbackToken = (token: string) => TOKEN_RE.test(token);

export function feedbackEnabled(overrides: Overrides, env: Env): boolean {
  return (effective(FEEDBACK_ENABLED_KEY, overrides, env) ?? 'on').toLowerCase() !== 'off';
}

export const sealFeedbackToken = (token: string, box: SettingsSecretBox) =>
  box.seal(FEEDBACK_TOKEN_ENV, token);

export function resolveFeedbackSettings(
  overrides: Overrides,
  env: Env,
  box: SealedSecretOpener | null,
): FeedbackSettings {
  const sealed = overrides.get(FEEDBACK_SEALED_TOKEN_KEY);
  // texto puro gravado direto no banco nunca abre (o cofre só aceita o formato cifrado)
  const panelToken = sealed ? (box?.open(FEEDBACK_TOKEN_ENV, sealed) ?? null) : null;
  const token = panelToken ?? (env[FEEDBACK_TOKEN_ENV]?.trim() || null);
  const repo = effective(FEEDBACK_REPO_KEY, overrides, env);
  return {
    enabled: feedbackEnabled(overrides, env),
    token,
    repo,
    config: feedbackGithubConfig({
      FEEDBACK_GITHUB_TOKEN: token ?? undefined,
      FEEDBACK_GITHUB_REPO: repo ?? undefined,
    }),
    tokenUnreadable: Boolean(sealed) && panelToken === null,
    tokenInPanel: Boolean(sealed),
  };
}
