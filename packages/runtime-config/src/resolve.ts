import { cronError, isCronOff } from './cron.js';
import {
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
  | 'format';

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
 * Vazio só vale para flags com `allowEmpty`; "unlimited" (ou 0) só para as com `unlimited` (com
 * `zeroIsOff`, 0 fica 0: desliga, não é "sem limite").
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
      if (def.unlimited && (lower === 'unlimited' || (lower === '0' && !def.zeroIsOff)))
        return ok('unlimited');
      const pattern = def.type === 'int' ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
      const normalized = value.replace(',', '.');
      if (!pattern.test(normalized)) return fail({ code: def.type === 'int' ? 'integer' : 'number' });
      if (def.zeroIsOff && Number(normalized) === 0) return ok('0');
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
      return def.pattern && !def.pattern.test(value) ? fail({ code: 'format' }) : ok(value);
    default:
      return fail({ code: 'readonly' });
  }
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

/** Resolve todas as flags (na ordem do registro), com os padrões que dependem de outra flag. */
export function resolveAll(input: ResolveInput, defs: readonly SettingDef[] = SETTINGS): ResolvedSetting[] {
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

export interface AppliedOverrides {
  /** Env com as sobrescritas e, quando houver alguma, `GALAXIE_RUNTIME_BASE`. */
  env: NodeJS.ProcessEnv;
  /** Chaves sobrescritas pelo banco (o valor pode ser igual ao do env). */
  applied: string[];
  /** Sobrescritas ignoradas: chave fora do registro, segredo ou valor inválido. */
  rejected: { key: string; error: ValidationError }[];
}

/**
 * Env de um processo com as sobrescritas do banco por cima. Só entram chaves do registro, nunca
 * segredos, e só valores válidos: o banco não consegue injetar variáveis arbitrárias (NODE_OPTIONS…).
 */
export function applyOverrides(
  env: NodeJS.ProcessEnv,
  overrides: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): AppliedOverrides {
  const out: NodeJS.ProcessEnv = { ...env };
  const base: Record<string, string | null> = { ...parseBase(env[RUNTIME_BASE_ENV]) };
  const applied: string[] = [];
  const rejected: AppliedOverrides['rejected'] = [];
  const entries = overrides instanceof Map ? [...overrides.entries()] : Object.entries(overrides);
  for (const [key, raw] of entries) {
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
  return { env: out, applied, rejected };
}

function parseBase(raw: string | undefined): Record<string, string | null> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([k, v]) => (typeof v === 'string' || v === null) && settingDef(k) && !isSecret(settingDef(k)!),
      ),
    ) as Record<string, string | null>;
  } catch {
    return {};
  }
}

/**
 * Env do contêiner por trás do env recebido do scheduler: desfaz as sobrescritas usando
 * `GALAXIE_RUNTIME_BASE`. É sobre ele que um processo longo reaplica o banco a cada releitura.
 */
export function runtimeBaseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = parseBase(env[RUNTIME_BASE_ENV]);
  const out: NodeJS.ProcessEnv = { ...env };
  delete out[RUNTIME_BASE_ENV];
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
