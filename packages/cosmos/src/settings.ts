/**
 * Flags da Cosmos no registro do painel (@galaxie/runtime-config, seção `cosmos`), lidas do banco a cada
 * reserva: precedência banco > env > padrão, com a mesma validação do painel.
 */
import { readRuntimeOverrides, type Database } from '@galaxie/db';
import { resolveSetting, settingDef, validateSettingKey } from '@galaxie/runtime-config';

export interface CosmosSettings {
  /** Teto de segurança do dia em US$ (custo real somado de todos os tenants); null = sem teto. */
  dailyUsdCeiling: number | null;
  /** US$ de custo que valem 1 crédito; null = não configurado (cada chamada cobra o mínimo). */
  creditUsd: number | null;
}

type Env = Record<string, string | undefined>;

function value(key: string, overrides: ReadonlyMap<string, string>, env: Env): string | null {
  const def = settingDef(key);
  if (!def) throw new Error(`${key} fora do registro de runtime settings`);
  const resolved = resolveSetting(def, {
    overrides,
    env: (k) => {
      // env inválido não vale: o painel não aceitaria o mesmo valor
      // e vale normalizado como o painel grava ('0,01' vira '0.01'), senão o Number() de depois dá NaN
      const raw = env[k]?.trim();
      if (!raw) return undefined;
      const checked = validateSettingKey(k, raw);
      return checked.ok ? checked.value : undefined;
    },
  });
  return resolved.value;
}

/** Interpreta as flags já resolvidas (texto). */
export function parseCosmosSettings(raw: {
  ceiling: string | null;
  creditUsd: string | null;
}): CosmosSettings {
  const ceiling = raw.ceiling === null || raw.ceiling === 'unlimited' ? null : Number(raw.ceiling);
  const credit = raw.creditUsd === null ? null : Number(raw.creditUsd);
  return {
    dailyUsdCeiling: ceiling !== null && Number.isFinite(ceiling) ? ceiling : null,
    creditUsd: credit !== null && Number.isFinite(credit) && credit > 0 ? credit : null,
  };
}

export async function readCosmosSettings(
  db: Pick<Database, 'select'>,
  env: Env = process.env,
): Promise<CosmosSettings> {
  const overrides = await readRuntimeOverrides(db);
  return parseCosmosSettings({
    ceiling: value('COSMOS_DAILY_USD_CEILING', overrides, env),
    creditUsd: value('COSMOS_CREDIT_USD', overrides, env),
  });
}
