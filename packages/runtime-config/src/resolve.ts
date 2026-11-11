import { cronError, isCronOff } from './cron.js';
import {
  isPanelSecret,
  isSecret,
  settingDef,
  settingsForService,
  SETTINGS,
  type RuntimeService,
  type SettingDef,
} from './registry.js';

export type ValidationErrorCode =
  | 'unknown'
  | 'readonly'
  | 'required'
  | 'enum'
  | 'integer'
  | 'number'
  | 'range'
  | 'cron'
  | 'markets'
  | 'format'
  | 'zero'
  | 'shares'
  /** Espelho: período 0 (use `off`). */
  | 'periodZero'
  /** Espelho: endpoint fora do catálogo da API. */
  | 'mirrorItem'
  /** Espelho: a ordem tem que listar cada grupo uma vez. */
  | 'groupOrder'
  /** Segredo do painel que não abre: sem a SETTINGS_KEK no processo, KEK trocada ou dado alterado. */
  | 'sealed';

export interface ValidationError {
  code: ValidationErrorCode;
  min?: number;
  max?: number;
  /** Valores aceitos (enum) ou inválidos (markets). */
  values?: readonly string[];
  /** Detalhe técnico (ex.: mensagem do croner). */
  detail?: string;
}

export type Validation = { ok: true; value: string } | { ok: false; error: ValidationError };

const ok = (value: string): Validation => ({ ok: true, value });
const fail = (error: ValidationError): Validation => ({ ok: false, error });

function range(def: SettingDef, n: number, value: string): Validation {
  if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max))
    return fail({
      code: 'range',
      ...(def.min !== undefined ? { min: def.min } : {}),
      ...(def.max !== undefined ? { max: def.max } : {}),
    });
  return ok(value);
}

/**
 * Valida e normaliza o valor de uma flag (o que vai para o banco). Segredos nunca são aceitos.
 * Vazio só vale para flags com `allowEmpty`; "unlimited" (ou 0) só para as com `unlimited`. Com
 * `zeroInvalid`, 0 é recusado (código `zero`): não desliga nem tira o teto (use AI_STATUS=off ou "unlimited").
 */
export function validateSetting(def: SettingDef, raw: string): Validation {
  if (isSecret(def)) return fail({ code: 'readonly' });
  const value = raw.trim();
  if (!value) return def.allowEmpty ? ok('') : fail({ code: 'required' });

  switch (def.type) {
    case 'cron': {
      if (isCronOff(value)) return ok('off');
      const pattern = value.replace(/\s+/g, ' ');
      if (pattern.split(' ').length !== 5) return fail({ code: 'cron', detail: '5 campos' });
      const err = cronError(pattern);
      return err ? fail({ code: 'cron', detail: err }) : ok(pattern);
    }
    case 'enum': {
      const v = value.toLowerCase();
      return def.options?.includes(v) ? ok(v) : fail({ code: 'enum', values: def.options ?? [] });
    }
    case 'int':
    case 'number': {
      const lower = value.toLowerCase();
      if (def.unlimited && (lower === 'unlimited' || (lower === '0' && !def.zeroInvalid)))
        return ok('unlimited');
      const pattern = def.type === 'int' ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
      const normalized = value.replace(',', '.');
      if (!pattern.test(normalized)) return fail({ code: def.type === 'int' ? 'integer' : 'number' });
      if (def.zeroInvalid && Number(normalized) === 0) return fail({ code: 'zero' });
      return range(def, Number(normalized), String(Number(normalized)));
    }
    case 'markets': {
      const list = [
        ...new Set(
          value
            .split(/[\s,;]+/)
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        ),
      ];
      const invalid = list.filter((c) => !def.options?.includes(c));
      if (invalid.length) return fail({ code: 'markets', values: invalid });
      // na ordem do registro: o mesmo conjunto sempre grava o mesmo texto
      return ok((def.options ?? []).filter((c) => list.includes(c)).join(','));
    }
    case 'text':
      if (def.zeroInvalid && /(^|[,;\s])[^=,;\s]+=0+(\.0+)?(?=$|[,;\s])/.test(value))
        return fail({ code: 'zero' });
      if (def.pattern && !def.pattern.test(value)) return fail({ code: 'format' });
      {
        const err = def.check?.(value);
        return err ? fail(err) : ok(value);
      }
    default:
      return fail({ code: 'readonly' });
  }
}

/**
 * Valida o valor de um segredo que o painel troca (#1087), antes de cifrar e de novo depois de abrir: o formato do
 * provedor (`pattern` do registro). O erro nunca leva o valor. Segredo só do .env (ou chave fora do registro) é `readonly`.
 */
export function validateSecretValue(def: SettingDef | undefined, raw: string): Validation {
  if (!isPanelSecret(def)) return fail({ code: def ? 'readonly' : 'unknown' });
  const value = raw.trim();
  if (!value) return fail({ code: 'required' });
  return def.pattern && !def.pattern.test(value) ? fail({ code: 'format' }) : ok(value);
}

/** Sufixo da linha de `ops.runtime_setting` com o segredo cifrado (`APISPORTS_KEY_SEALED`). */
export const SEALED_SUFFIX = '_SEALED';
export const sealedKey = (key: string) => `${key}${SEALED_SUFFIX}`;

/** A chave do registro por trás de uma linha `<CHAVE>_SEALED`; null para outras linhas. */
export function sealedBaseKey(rowKey: string): string | null {
  return rowKey.endsWith(SEALED_SUFFIX) ? rowKey.slice(0, -SEALED_SUFFIX.length) : null;
}

/**
 * Quem abre o cifrado de uma linha `<CHAVE>_SEALED` (`SettingsSecretBox`, em `@galaxie/runtime-config/sealed`, que usa
 * `node:crypto` e por isso fica fora deste módulo, importado também no navegador). `null` = não abre.
 */
export interface SealedSecretOpener {
  open(key: string, stored: string): string | null;
}

/** Valida pela chave (as server actions recebem a chave do navegador). */
export function validateSettingKey(key: string, raw: string): Validation {
  const def = settingDef(key);
  return def ? validateSetting(def, raw) : fail({ code: 'unknown' });
}

export type SettingSource = 'db' | 'env' | 'default';

export interface ResolvedSetting {
  key: string;
  /** Valor efetivo (texto); `null` = vazio, o serviço usa o próprio comportamento padrão. */
  value: string | null;
  source: SettingSource;
  /** Padrão do código (já resolvido pelo `defaultBy`, quando houver). */
  defaultValue: string | null;
  /** Valor do env do contêiner de referência, quando informado. */
  envValue: string | null;
  /** Sobrescrita gravada no banco, quando houver (válida ou não). */
  override: string | null;
  /** A sobrescrita do banco é inválida (ex.: o registro mudou): o serviço a ignora. */
  overrideInvalid: boolean;
}

export interface ResolveInput {
  /** Sobrescritas do banco (ops.runtime_setting), por chave. */
  overrides: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  /** Env do contêiner de referência de cada flag (o que o serviço relatou). */
  env: (key: string) => string | undefined | null;
}

const get = (m: ResolveInput['overrides'], key: string) =>
  m instanceof Map ? m.get(key) : (m as Record<string, string>)[key];

const present = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Precedência: banco > env > padrão do código. A sobrescrita do banco só vale se passar na validação
 * (um valor antigo que o registro deixou de aceitar não derruba o serviço). Env vazio conta como ausente,
 * porque o compose repassa `${X:-}` como string vazia.
 */
export function resolveSetting(
  def: SettingDef,
  input: ResolveInput,
  resolvedDefault?: string | null,
): ResolvedSetting {
  const defaultValue = resolvedDefault !== undefined ? resolvedDefault : def.default;
  const envRaw = input.env(def.key);
  const envValue = present(envRaw) ? envRaw.trim() : null;
  const raw = isSecret(def) ? undefined : get(input.overrides, def.key);
  const override = raw ?? null;
  const checked = override !== null ? validateSetting(def, override) : null;
  const base = { key: def.key, defaultValue, envValue, override, overrideInvalid: checked?.ok === false };
  if (checked?.ok) return { ...base, value: checked.value === '' ? null : checked.value, source: 'db' };
  if (envValue !== null) return { ...base, value: envValue, source: 'env' };
  return { ...base, value: defaultValue, source: 'default' };
}

/** Sobrescrita antiga convertida na leitura (o banco não é alterado). */
export interface LegacyConversion {
  key: string;
  from: string;
  /** Chaves e valores que passaram a valer no lugar (`null` = a sobrescrita saiu). */
  to: Record<string, string | null>;
}

const isZero = (v: string) => /^0+([.,]0+)?$/.test(v.trim());
const entryList = (raw: string | null | undefined) => (raw ?? '').split(/[,;\s]+/).filter(Boolean);

/**
 * Sobrescritas gravadas antes do estado literal, em que 0 tinha sentido: `AI_DAILY_USD_BUDGET=0` era
 * "IA desligada" (#332) e vira `AI_STATUS=off`; `AI_AGENT_USD_BUDGETS` com `agente=0` era "agente sem
 * IA" e vira `agente=off` em AI_AGENT_STATUS, mantendo os outros tetos da linha; `AI_DAILY_TOKEN_BUDGET=0`
 * era "sem limite" e vira `unlimited`. Uma sobrescrita explícita das chaves novas prevalece. `env`
 * completa AI_AGENT_STATUS quando ele não está sobrescrito.
 */
export function upgradeLegacyOverrides(
  overrides: ResolveInput['overrides'],
  env: (key: string) => string | undefined | null,
): { overrides: Map<string, string>; converted: LegacyConversion[] } {
  const out = new Map(overrides instanceof Map ? overrides : Object.entries(overrides));
  const converted: LegacyConversion[] = [];
  const tokens = out.get('AI_DAILY_TOKEN_BUDGET');
  if (tokens !== undefined && isZero(tokens)) {
    out.set('AI_DAILY_TOKEN_BUDGET', 'unlimited');
    converted.push({
      key: 'AI_DAILY_TOKEN_BUDGET',
      from: tokens,
      to: { AI_DAILY_TOKEN_BUDGET: 'unlimited' },
    });
  }
  const usd = out.get('AI_DAILY_USD_BUDGET');
  if (usd !== undefined && isZero(usd)) {
    out.delete('AI_DAILY_USD_BUDGET');
    const to: Record<string, string | null> = { AI_DAILY_USD_BUDGET: null };
    if (!out.has('AI_STATUS')) {
      out.set('AI_STATUS', 'off');
      to.AI_STATUS = 'off';
    }
    converted.push({ key: 'AI_DAILY_USD_BUDGET', from: usd, to });
  }
  const budgets = out.get('AI_AGENT_USD_BUDGETS');
  if (budgets !== undefined) {
    const parts = entryList(budgets);
    const off = parts.filter((p) => isZero(p.split('=')[1] ?? '')).map((p) => p.split('=')[0]!);
    if (off.length) {
      const kept = parts.filter((p) => !isZero(p.split('=')[1] ?? '')).join(',');
      const status = entryList(out.get('AI_AGENT_STATUS') ?? env('AI_AGENT_STATUS'));
      const named = new Set(status.map((p) => p.split('=')[0]!.split('@')[0]!.toLowerCase()));
      const merged = [
        ...status,
        ...off.filter((a) => !named.has(a.split('@')[0]!.toLowerCase())).map((a) => `${a}=off`),
      ].join(',');
      out.set('AI_AGENT_USD_BUDGETS', kept);
      out.set('AI_AGENT_STATUS', merged);
      converted.push({
        key: 'AI_AGENT_USD_BUDGETS',
        from: budgets,
        to: { AI_AGENT_USD_BUDGETS: kept, AI_AGENT_STATUS: merged },
      });
    }
  }
  return { overrides: out, converted };
}

/** Resolve todas as flags (na ordem do registro), com os padrões que dependem de outra flag. */
export function resolveAll(input: ResolveInput, defs: readonly SettingDef[] = SETTINGS): ResolvedSetting[] {
  input = { ...input, overrides: upgradeLegacyOverrides(input.overrides, input.env).overrides };
  const done = new Map<string, ResolvedSetting>();
  const resolveOne = (def: SettingDef): ResolvedSetting => {
    const cached = done.get(def.key);
    if (cached) return cached;
    let dflt: string | null | undefined;
    if (def.defaultBy) {
      const parent = settingDef(def.defaultBy.key);
      const parentValue = parent ? resolveOne(parent).value : null;
      dflt = (parentValue && def.defaultBy.values[parentValue]) ?? def.default;
    }
    const out = resolveSetting(def, input, dflt);
    done.set(def.key, out);
    return out;
  };
  return defs.map(resolveOne);
}

/**
 * Variável que o scheduler passa a cada job com o valor original (do contêiner) das chaves que o banco
 * sobrescreveu. Um processo longo (o ao vivo) relê o banco e, se a sobrescrita sumiu ("voltar ao
 * padrão"), volta ao valor do contêiner em vez de ficar com o que recebeu na partida.
 */
export const RUNTIME_BASE_ENV = 'GALAXIE_RUNTIME_BASE';
/**
 * O mesmo para os segredos trocados no painel (#1087), numa variável à parte: `GALAXIE_RUNTIME_BASE` nunca leva
 * segredo. Guarda o valor do .env do contêiner (o processo filho já recebe segredos pelo env de qualquer forma), para
 * o "Voltar ao .env" valer também num processo longo.
 */
export const RUNTIME_SECRET_BASE_ENV = 'GALAXIE_RUNTIME_SECRET_BASE';

export interface AppliedOverrides {
  /** Env com as sobrescritas e, quando houver alguma, `GALAXIE_RUNTIME_BASE`. */
  env: NodeJS.ProcessEnv;
  /** Chaves sobrescritas pelo banco (o valor pode ser igual ao do env). Nunca inclui segredos. */
  applied: string[];
  /** Segredos trocados no painel que entraram no env (só os nomes: o valor nunca vai para log). */
  secrets: string[];
  /** Sobrescritas ignoradas: chave fora do registro, segredo, valor inválido ou cifrado que não abre. */
  rejected: { key: string; error: ValidationError }[];
  /** Sobrescritas antigas convertidas para o estado literal (ex.: AI_DAILY_USD_BUDGET=0 → AI_STATUS=off). */
  converted: LegacyConversion[];
}

export interface ApplyOverridesOptions {
  /**
   * Abre os segredos trocados no painel (`<CHAVE>_SEALED`). Sem ele (ou `null`: sem `SETTINGS_KEK`), cada linha
   * cifrada vai para `rejected` com `sealed` e o processo segue com o .env.
   */
  secrets: SealedSecretOpener | null;
  /**
   * Serviços que este processo atende: só os segredos que eles leem entram no env (o token das sugestões, da demo,
   * nunca chega aos jobs). Os outros são ignorados sem aviso.
   */
  services: readonly RuntimeService[];
}

/**
 * Env de um processo com as sobrescritas do banco por cima. Só entram chaves do registro e só valores válidos: o banco
 * não consegue injetar variáveis arbitrárias (NODE_OPTIONS…). Segredos só pela linha cifrada `<CHAVE>_SEALED` de um
 * segredo que o painel troca, aberta com `options.secrets` e conferida pelo formato do provedor; se não abrir, vale o .env.
 */
export function applyOverrides(
  env: NodeJS.ProcessEnv,
  overrides: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  options?: ApplyOverridesOptions,
): AppliedOverrides {
  const out: NodeJS.ProcessEnv = { ...env };
  const base: Record<string, string | null> = { ...parseBase(env[RUNTIME_BASE_ENV]) };
  const secretBase: Record<string, string | null> = { ...parseSecretBase(env[RUNTIME_SECRET_BASE_ENV]) };
  const applied: string[] = [];
  const secrets: string[] = [];
  const rejected: AppliedOverrides['rejected'] = [];
  const upgraded = upgradeLegacyOverrides(overrides, (key) => env[key]);
  const entries = [...upgraded.overrides.entries()];
  for (const [key, raw] of entries) {
    const secretKey = sealedBaseKey(key);
    if (secretKey !== null) {
      const def = settingDef(secretKey);
      if (!isPanelSecret(def)) {
        // linha cifrada de chave fora do registro (ou de segredo só do .env): nunca entra
        rejected.push({ key, error: { code: 'unknown' } });
        continue;
      }
      if (options && !def.services.some((s) => options.services.includes(s))) continue;
      const opened = options?.secrets?.open(secretKey, raw) ?? null;
      const checked = opened === null ? fail({ code: 'sealed' }) : validateSecretValue(def, opened);
      if (!checked.ok) {
        rejected.push({ key, error: checked.error });
        continue;
      }
      if (!(secretKey in secretBase)) secretBase[secretKey] = env[secretKey] ?? null;
      out[secretKey] = checked.value;
      secrets.push(secretKey);
      continue;
    }
    const def = settingDef(key);
    const checked = def ? validateSetting(def, raw) : fail({ code: 'unknown' });
    if (!checked.ok) {
      rejected.push({ key, error: checked.error });
      continue;
    }
    if (!(key in base)) base[key] = env[key] ?? null;
    out[key] = checked.value;
    applied.push(key);
  }
  if (applied.length) out[RUNTIME_BASE_ENV] = JSON.stringify(base);
  if (secrets.length) out[RUNTIME_SECRET_BASE_ENV] = JSON.stringify(secretBase);
  else delete out[RUNTIME_SECRET_BASE_ENV];
  return { env: out, applied, secrets, rejected, converted: upgraded.converted };
}

function parseBaseWith(
  raw: string | undefined,
  accept: (def: SettingDef) => boolean,
): Record<string, string | null> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([k, v]) => {
        const def = settingDef(k);
        return (typeof v === 'string' || v === null) && def !== undefined && accept(def);
      }),
    ) as Record<string, string | null>;
  } catch {
    return {};
  }
}

const parseBase = (raw: string | undefined) => parseBaseWith(raw, (def) => !isSecret(def));
const parseSecretBase = (raw: string | undefined) => parseBaseWith(raw, isPanelSecret);

/**
 * Env do contêiner por trás do env recebido do scheduler: desfaz as sobrescritas usando
 * `GALAXIE_RUNTIME_BASE` (e os segredos do painel, `GALAXIE_RUNTIME_SECRET_BASE`). É sobre ele que um processo longo reaplica o banco a cada releitura.
 */
export function runtimeBaseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = { ...parseBase(env[RUNTIME_BASE_ENV]), ...parseSecretBase(env[RUNTIME_SECRET_BASE_ENV]) };
  const out: NodeJS.ProcessEnv = { ...env };
  delete out[RUNTIME_BASE_ENV];
  delete out[RUNTIME_SECRET_BASE_ENV];
  for (const [k, v] of Object.entries(base)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

export interface EnvReportEntry {
  key: string;
  /** Valor do env; sempre `null` para segredos. */
  value: string | null;
  /** A variável está definida e não vazia. */
  configured: boolean;
}

/** O que um contêiner relata ao painel sobre o próprio env: valores das flags, segredos só como booleano. */
export function envReport(service: RuntimeService, env: NodeJS.ProcessEnv): EnvReportEntry[] {
  return settingsForService(service).map((def) => {
    const raw = env[def.key];
    const configured = present(raw);
    return { key: def.key, value: isSecret(def) || !configured ? null : raw!.trim(), configured };
  });
}
