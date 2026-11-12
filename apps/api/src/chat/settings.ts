/**
 * Padrão e teto da Galaxie para o Chat ao vivo (`CHAT_*` em Ajustes → Engajamento), relidos no máximo a cada minuto.
 * Banco fora: segue com o último valor lido (ou o padrão do registro).
 */
import { readRuntimeOverrides, type Database } from '@galaxie/db';
import { resolveSetting, settingDef } from '@galaxie/runtime-config';

export const CHAT_SETTING_KEYS = {
  openBeforeMinutes: 'CHAT_ROOM_OPEN_BEFORE_MINUTES',
  closeAfterMinutes: 'CHAT_ROOM_CLOSE_AFTER_MINUTES',
  slowModeSeconds: 'CHAT_SLOW_MODE_SECONDS',
  maxChars: 'CHAT_MESSAGE_MAX_CHARS',
  historyOnJoin: 'CHAT_HISTORY_ON_JOIN',
} as const;

export type ChatSettingsValues = Record<keyof typeof CHAT_SETTING_KEYS, number>;

function defaults(): ChatSettingsValues {
  const out = {} as ChatSettingsValues;
  for (const [name, key] of Object.entries(CHAT_SETTING_KEYS) as [keyof ChatSettingsValues, string][])
    out[name] = Number(settingDef(key)!.default);
  return out;
}

export class ChatSettings {
  private values = defaults();
  private readAt = 0;
  constructor(
    private readonly db: Database | undefined,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<ChatSettingsValues> {
    if (this.now() - this.readAt < 60_000) return this.values;
    this.readAt = this.now();
    try {
      const overrides = this.db ? await readRuntimeOverrides(this.db) : new Map<string, string>();
      const next = { ...this.values };
      for (const [name, key] of Object.entries(CHAT_SETTING_KEYS) as [keyof ChatSettingsValues, string][]) {
        const def = settingDef(key)!;
        const n = Number(resolveSetting(def, { overrides, env: (k) => this.env[k] }).value);
        if (Number.isInteger(n) && n >= (def.min ?? 0) && n <= (def.max ?? Number.MAX_SAFE_INTEGER))
          next[name] = n;
      }
      this.values = next;
    } catch {
      // painel indisponível: segue com o último valor lido
    }
    return this.values;
  }
}
