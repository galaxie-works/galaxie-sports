/**
 * Acervo customizado de logos na API (flag ASSETS_CUSTOM_LOGOS, painel Ajustes → Operação). Ligada, toda
 * consulta que mostra o logo de um time ou de uma competição usa `custom_logo_asset_id` (o logo do acervo,
 * importado por `assets:acervo`) quando houver, e o `logo_asset_id` do fornecedor no resto; desligada,
 * só o do fornecedor. A flag é relida do banco a cada 15 s (banco > env > padrão), sem reiniciar a API.
 *
 * Cache: a versão da flag (valor + instante da última mudança no painel) entra na chave de todas as
 * respostas (`VariantResponseCache`). Ligar ou desligar passa a ler chaves novas na hora, sem purge, e uma
 * resposta montada no meio da troca fica numa chave que nenhuma requisição usa mais.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  competition,
  participant,
  readRuntimeSettingState,
  touchRuntimeEnv,
  type Database,
} from '@galaxie/db';
import { resolveSetting, settingDef } from '@galaxie/runtime-config';
import type { CachedResponse, ResponseCache } from '../cache/store.js';

export const CUSTOM_LOGOS_KEY = 'ASSETS_CUSTOM_LOGOS';

/** Estado da flag visto pela API. */
export interface CustomLogos {
  /** Usar o logo do acervo onde houver. */
  enabled(): boolean;
  /** Parte da chave do cache que muda a cada troca da flag ('' enquanto nunca foi mexida e está desligada). */
  variant(): string;
}

/** Valor fixo (testes e API sem banco). */
export class StaticCustomLogos implements CustomLogos {
  constructor(private readonly on = false) {}
  enabled(): boolean {
    return this.on;
  }
  variant(): string {
    return this.on ? 'logos:acervo' : '';
  }
}

export interface DbCustomLogosOptions {
  /** Releitura do banco (ms). Padrão 15 s. */
  intervalMs?: number;
  env?: NodeJS.ProcessEnv;
  onError?: (err: unknown) => void;
}

/** Variante da chave do cache para um estado da flag. */
export function logosVariant(enabled: boolean, changedAt: Date | null): string {
  if (!changedAt) return enabled ? 'logos:acervo' : '';
  return `logos:${enabled ? 'acervo' : 'fornecedor'}@${changedAt.getTime()}`;
}

/**
 * Lê a flag do banco em intervalo fixo. Também marca a API como viva em ops.runtime_env: o painel avisa
 * "serviço fora do ar" quando quem lê a flag não relata há minutos.
 */
export class DbCustomLogos implements CustomLogos {
  private on: boolean;
  private version = '';
  private timer: NodeJS.Timeout | undefined;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly db: Database,
    private readonly options: DbCustomLogosOptions = {},
  ) {
    this.env = options.env ?? process.env;
    this.on = this.resolve(null);
  }

  private resolve(override: string | null): boolean {
    const def = settingDef(CUSTOM_LOGOS_KEY)!;
    const overrides = override === null ? new Map<string, string>() : new Map([[CUSTOM_LOGOS_KEY, override]]);
    return resolveSetting(def, { overrides, env: (k) => this.env[k] }).value === 'on';
  }

  /** Relê o banco agora (também usado nos testes). */
  async refresh(): Promise<void> {
    const state = await readRuntimeSettingState(this.db, CUSTOM_LOGOS_KEY);
    this.on = this.resolve(state.value);
    this.version = logosVariant(this.on, state.changedAt);
    await touchRuntimeEnv(this.db, 'api');
  }

  async start(): Promise<void> {
    const tick = () => this.refresh().catch((err) => this.options.onError?.(err));
    await tick();
    this.timer = setInterval(tick, this.options.intervalMs ?? 15_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  enabled(): boolean {
    return this.on;
  }

  variant(): string {
    return this.version || logosVariant(this.on, null);
  }
}

/** Cache de respostas com a versão da flag dos logos na chave (purge por tag continua igual). */
export class VariantResponseCache implements ResponseCache {
  constructor(
    private readonly inner: ResponseCache,
    private readonly logos: CustomLogos,
  ) {}

  private key(k: string): string {
    const v = this.logos.variant();
    return v ? `${k}~${v}` : k;
  }

  get(key: string): Promise<CachedResponse | undefined> {
    return this.inner.get(this.key(key));
  }

  set(key: string, value: CachedResponse, ttlSec: number, since?: number): Promise<boolean> {
    return this.inner.set(this.key(key), value, ttlSec, since);
  }

  purgeTags(tags: string[]): Promise<number> {
    return this.inner.purgeTags(tags);
  }

  purgeMark(): Promise<number> {
    return this.inner.purgeMark();
  }
}

// ─── consultas ───────────────────────────────────────────────────────────────────────────────────

function effective(
  custom: AnyPgColumn,
  provider: AnyPgColumn,
  on: boolean,
): SQL<string | null> | AnyPgColumn {
  return on ? sql<string | null>`coalesce(${custom}, ${provider})` : provider;
}

/** Id do escudo a mostrar para o time (join com core.asset): o do acervo com a flag ligada, senão o do fornecedor. */
export function teamLogoId(on: boolean) {
  return effective(participant.customLogoAssetId, participant.logoAssetId, on);
}

/** Id do logo a mostrar para a competição (mesma regra do time). */
export function competitionLogoId(on: boolean) {
  return effective(competition.customLogoAssetId, competition.logoAssetId, on);
}

/** O mesmo em SQL cru, para as consultas escritas à mão: `alias` é o da tabela (p, c, r...). */
export function logoIdSql(alias: string, on: boolean): SQL {
  const a = sql.raw(alias);
  return on ? sql`coalesce(${a}.custom_logo_asset_id, ${a}.logo_asset_id)` : sql`${a}.logo_asset_id`;
}
