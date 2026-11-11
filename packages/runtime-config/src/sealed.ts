import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

import type { RuntimeService } from './registry.js';
import type { EnvReportEntry, SealedSecretOpener } from './resolve.js';
import { envReport, sealedKey } from './resolve.js';

/**
 * Cofre dos segredos trocados no painel de Ajustes (#1087). Só no servidor (usa `node:crypto`): fica numa entrada própria
 * do pacote (`@galaxie/runtime-config/sealed`), porque o registro e a validação também vão para o navegador.
 *
 * O valor fica em `ops.runtime_setting` na linha `<CHAVE>_SEALED`, cifrado com AES-256-GCM pela KEK `SETTINGS_KEK` (fora
 * do banco: um dump não abre nada). O dado autenticado (AAD) é `ops.runtime_setting:<CHAVE>_SEALED`: copiar o cifrado
 * para outra chave não funciona. Formato: `enc:s1:<kid>:<iv>:<cifrado>:<tag>` (base64url), tag de 16 bytes exigida.
 *
 * - **Várias KEKs** (`nova,antiga`): cifra com a primeira e abre com qualquer uma, para trocar a KEK sem janela
 *   (recifra tudo com a nova e depois tira a antiga; docs/runbooks/chaves-no-painel.md).
 * - **Sem KEK, KEK curta ou trocada**: `open` devolve `null` e quem lê fica com o .env; `seal` recusa.
 * - **Legado**: o token das sugestões gravado antes deste cofre (`enc:v1:`, cifrado com a KEK dos webhooks,
 *   `WEBHOOK_SIGNING_SECRET`) continua abrindo, só para a chave dele, até ser recifrado.
 */

/** Variável com a KEK dos segredos do painel; várias separadas por vírgula (a primeira cifra). */
export const SETTINGS_KEK_ENV = 'SETTINGS_KEK';
/** KEK dos webhooks: só abre o token das sugestões gravado antes deste cofre. */
const LEGACY_KEK_ENV = 'WEBHOOK_SIGNING_SECRET';
const LEGACY_KEY = 'FEEDBACK_GITHUB_TOKEN';

const PREFIX = 'enc:s1:';
const LEGACY_PREFIX = 'enc:v1:';
const TAG_BYTES = 16;
/** IV do GCM: 12 bytes (o que `seal` gera); outro tamanho é recusado ao abrir. */
const IV_BYTES = 12;
export const MIN_SETTINGS_KEK_LENGTH = 32;

interface Kek {
  id: string;
  key: Buffer;
}

function derive(raw: string, info: string): Kek {
  const key = Buffer.from(hkdfSync('sha256', raw, Buffer.alloc(0), info, 32));
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
}

const splitKeys = (raw: string | undefined) =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Dado autenticado: a linha do banco que guarda o segredo. */
const aad = (key: string) => Buffer.from(`ops.runtime_setting:${sealedKey(key)}`, 'utf8');
/** O legado dos webhooks prefixava o "id do endpoint" (aqui, a linha do banco). */
const legacyAad = (key: string) =>
  Buffer.from(`api.webhook_endpoint:ops.runtime_setting:${sealedKey(key)}`, 'utf8');

const b64 = (b: Buffer) => b.toString('base64url');

function decrypt(keks: readonly Kek[], body: string, additional: Buffer): string | null {
  const [kid, iv, data, tag] = body.split(':');
  if (!kid || !iv || !data || !tag) return null;
  const kek = keks.find((k) => k.id === kid);
  if (!kek) return null;
  try {
    const authTag = Buffer.from(tag, 'base64url');
    // sem authTagLength o Node aceita tag truncada: exige os 16 bytes
    if (authTag.length !== TAG_BYTES) return null;
    const nonce = Buffer.from(iv, 'base64url');
    if (nonce.length !== IV_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', kek.key, nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(additional);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

export class SettingsSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsSecretError';
  }
}

/** Situação de uma linha cifrada para o painel: abre, ou por que não abre. Nunca leva o valor. */
export type SealedState = 'ok' | 'no-kek' | 'unreadable';

export class SettingsSecretBox implements SealedSecretOpener {
  private readonly keks: Kek[];
  private readonly legacy: Kek[];
  /** `SETTINGS_KEK` definida, mas alguma das chaves é curta demais (ignorada). */
  readonly invalid: boolean;

  constructor(rawKeys: readonly string[], options: { legacyKeys?: readonly string[] } = {}) {
    const valid = rawKeys.filter((k) => k.length >= MIN_SETTINGS_KEK_LENGTH);
    this.invalid = valid.length !== rawKeys.length;
    this.keks = valid.map((k) => derive(k, 'galaxie-sports/runtime-setting/v1'));
    this.legacy = (options.legacyKeys ?? [])
      .filter((k) => k.length >= MIN_SETTINGS_KEK_LENGTH)
      .map((k) => derive(k, 'galaxie-sports/webhook-secret/v1'));
  }

  /** Lê `SETTINGS_KEK` (e a KEK dos webhooks, só para o legado do token das sugestões). Nunca lança. */
  static fromEnv(env: Readonly<Record<string, string | undefined>> = process.env): SettingsSecretBox {
    return new SettingsSecretBox(splitKeys(env[SETTINGS_KEK_ENV]), {
      legacyKeys: splitKeys(env[LEGACY_KEK_ENV]),
    });
  }

  /** Há KEK para cifrar (e abrir) segredos do painel. */
  get configured(): boolean {
    return this.keks.length > 0;
  }

  /** Ids (8 hex, públicos: só a impressão da chave derivada) das KEKs válidas; a primeira é a que cifra. */
  get kids(): string[] {
    return this.keks.map((k) => k.id);
  }

  /** Cifra o segredo da chave `key` (ex.: `APISPORTS_KEY`) com a KEK atual; o resultado vai na linha `<key>_SEALED`. */
  seal(key: string, value: string): string {
    const kek = this.keks[0];
    if (!kek)
      throw new SettingsSecretError(
        `${SETTINGS_KEK_ENV} não definida (ou curta demais): o segredo não pode ser gravado sem cifra.`,
      );
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', kek.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad(key));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${PREFIX}${kek.id}:${b64(iv)}:${b64(data)}:${b64(cipher.getAuthTag())}`;
  }

  /** Abre a linha cifrada da chave `key`; `null` se não abrir (sem KEK, KEK trocada, dado alterado ou texto puro). */
  open(key: string, stored: string): string | null {
    if (stored.startsWith(PREFIX)) return decrypt(this.keks, stored.slice(PREFIX.length), aad(key));
    if (key === LEGACY_KEY && stored.startsWith(LEGACY_PREFIX))
      return decrypt(this.legacy, stored.slice(LEGACY_PREFIX.length), legacyAad(key));
    return null;
  }

  state(key: string, stored: string): SealedState {
    if (this.open(key, stored) !== null) return 'ok';
    return this.configured ? 'unreadable' : 'no-kek';
  }

  /** Abre, mas não com a KEK atual (legado ou KEK antiga): recifrar com a atual. */
  needsReseal(key: string, stored: string): boolean {
    if (!this.configured || this.open(key, stored) === null) return false;
    return !stored.startsWith(`${PREFIX}${this.keks[0]!.id}:`);
  }
}

let cached: { raw: string; box: SettingsSecretBox } | undefined;

/** O cofre do processo, refeito só se a KEK do env mudar (a derivação não roda a cada leitura). */
export function settingsSecretBox(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SettingsSecretBox {
  const raw = `${env[SETTINGS_KEK_ENV] ?? ''}\n${env[LEGACY_KEK_ENV] ?? ''}`;
  if (cached?.raw !== raw) cached = { raw, box: SettingsSecretBox.fromEnv(env) };
  return cached.box;
}

/**
 * Os últimos 4 caracteres de um segredo, para a tela reconhecer qual está gravado sem mostrá-lo. Só para valores
 * longos (16+): num curto, 4 caracteres seriam parte demais dele. Nunca para senha digitada por gente (`SMTP_PASSWORD`):
 * o final dela costuma ser a parte que muda de uma senha para outra.
 */
export function secretHint(value: string, key?: string): string | null {
  if (key !== undefined && NO_HINT_KEYS.has(key)) return null;
  return value.length >= 16 ? value.slice(-4) : null;
}

/** Segredos sem o final na tela: senhas escolhidas por gente, não chaves geradas pelo provedor. */
const NO_HINT_KEYS: ReadonlySet<string> = new Set(['SMTP_PASSWORD']);

/**
 * Situação da `SETTINGS_KEK` que cada serviço relata ao painel (no valor da linha `SETTINGS_KEK` de `ops.runtime_env`):
 * os ids das KEKs válidas (não secretos) e se alguma é curta demais. Com isso o painel diz, por serviço, se a chave
 * gravada abre lá.
 */
export interface SettingsKekStatus {
  kids: string[];
  invalid: boolean;
}

export function settingsKekStatus(box: SettingsSecretBox): SettingsKekStatus {
  return { kids: box.kids, invalid: box.invalid };
}

/** Lê o relato de um serviço; `null` se não relatou os ids (serviço de antes deste relato, ou sem KEK). */
export function parseSettingsKekStatus(value: string | null | undefined): SettingsKekStatus | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SettingsKekStatus> | null;
    if (!parsed || !Array.isArray(parsed.kids)) return null;
    const kids = parsed.kids.filter((k): k is string => typeof k === 'string' && /^[0-9a-f]{8}$/.test(k));
    return { kids, invalid: parsed.invalid === true };
  } catch {
    return null;
  }
}

/**
 * `envReport` com a situação da KEK: a linha `SETTINGS_KEK` leva os ids e a validade (nunca a chave). É o relato que os
 * serviços com cofre (scheduler, API, demo) mandam ao painel.
 */
export function envReportWithKek(service: RuntimeService, env: NodeJS.ProcessEnv): EnvReportEntry[] {
  return envReport(service, env).map((entry) =>
    entry.key === SETTINGS_KEK_ENV && entry.configured
      ? { ...entry, value: JSON.stringify(settingsKekStatus(SettingsSecretBox.fromEnv(env))) }
      : entry,
  );
}

/** Id da KEK com que a linha foi cifrada (`enc:s1:<kid>:…`); `null` no formato antigo ou em texto puro. */
export function sealedKid(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  return stored.slice(PREFIX.length).split(':')[0] || null;
}
