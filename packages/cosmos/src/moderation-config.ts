/**
 * Configuração da moderação da Cosmos por cliente, sala e comunidade (#997): leitura dentro do teto da Galaxie,
 * gravação versionada (quem mudou e quando) e histórico. É a tabela única de escada e padrões de autonomia da
 * plataforma; comunidades (#951) e chat (#981) apontam para cá. As regras puras ficam em `moderation-rules.ts`.
 *
 * O servidor valida tudo de novo (`parseModerationConfig`): payload forjado com suspensão automática, degrau acima do
 * teto ou campo desconhecido é recusado. Se a Galaxie baixar o teto depois, a leitura já devolve o degrau rebaixado.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
// subcaminhos, não o índice: o índice traz o migrator (pasta drizzle/), que o bundler do Next não resolve
import type { Database } from '@galaxie/db/client';
import {
  MODERATION_SCOPE_KINDS,
  moderationConfig,
  moderationConfigLog,
  type ModerationScopeKind,
} from '@galaxie/db/schema';
import { CosmosError } from './errors.js';
import {
  normalizeModerationConfig,
  parseModerationConfig,
  type ModerationCeiling,
  type ModerationConfig,
  type ModerationOverride,
} from './moderation-rules.js';

export { MODERATION_SCOPE_KINDS, type ModerationScopeKind };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ModerationScope {
  kind: ModerationScopeKind;
  /** Id da sala ou da comunidade; vazio para o cliente. */
  id: string;
}

export const TENANT_SCOPE: ModerationScope = { kind: 'tenant', id: '' };

const SCOPE_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

export function isModerationScope(v: unknown): v is ModerationScope {
  if (!isObject(v) || !(MODERATION_SCOPE_KINDS as readonly string[]).includes(v.kind as string)) return false;
  return v.kind === 'tenant' ? v.id === '' : typeof v.id === 'string' && SCOPE_ID.test(v.id);
}

export interface StoredModerationConfig {
  scope: ModerationScope;
  /** Como está gravado (na exceção, só o que muda). */
  config: ModerationConfig | ModerationOverride;
  version: number;
  updatedBy: string;
  updatedAt: Date;
}

export interface ResolvedModerationConfig {
  /** O que vale no escopo pedido: cliente + exceção, dentro do teto atual. */
  effective: ModerationConfig;
  /** Linha do cliente; null = nunca salvou (vale o padrão). */
  tenant: StoredModerationConfig | null;
  /** Exceção do escopo pedido, se houver. */
  override: StoredModerationConfig | null;
  ceiling: ModerationCeiling;
}

type Row = typeof moderationConfig.$inferSelect;
const toStored = (row: Row): StoredModerationConfig => ({
  scope: { kind: row.scopeKind, id: row.scopeId },
  config: row.config as ModerationConfig | ModerationOverride,
  version: row.version,
  updatedBy: row.updatedBy,
  updatedAt: row.updatedAt,
});

/** Configuração que vale num escopo (o cliente todo, por padrão). */
export async function loadModerationConfig(
  db: Pick<Database, 'select'>,
  tenantId: string,
  ceiling: ModerationCeiling,
  scope: ModerationScope = TENANT_SCOPE,
): Promise<ResolvedModerationConfig> {
  const rows = await db
    .select()
    .from(moderationConfig)
    .where(
      and(
        eq(moderationConfig.tenantId, tenantId),
        sql`(${moderationConfig.scopeKind}, ${moderationConfig.scopeId}) in (('tenant', ''), (${scope.kind}, ${scope.id}))`,
      ),
    );
  const tenantRow = rows.find((r) => r.scopeKind === 'tenant') ?? null;
  const overrideRow =
    scope.kind === 'tenant'
      ? null
      : (rows.find((r) => r.scopeKind === scope.kind && r.scopeId === scope.id) ?? null);
  const base = normalizeModerationConfig(tenantRow?.config, ceiling);
  const effective = overrideRow ? normalizeModerationConfig(overrideRow.config, ceiling, base) : base;
  return {
    effective,
    tenant: tenantRow ? toStored(tenantRow) : null,
    override: overrideRow ? toStored(overrideRow) : null,
    ceiling,
  };
}

/** Exceções gravadas do cliente (salas e comunidades), da mais recente para a mais antiga. */
export async function listModerationOverrides(
  db: Pick<Database, 'select'>,
  tenantId: string,
): Promise<StoredModerationConfig[]> {
  const rows = await db
    .select()
    .from(moderationConfig)
    .where(and(eq(moderationConfig.tenantId, tenantId), sql`${moderationConfig.scopeKind} <> 'tenant'`))
    .orderBy(desc(moderationConfig.updatedAt));
  return rows.map(toStored);
}

export interface SaveModerationInput {
  tenantId: string;
  scope: ModerationScope;
  /** O que veio do cliente; validado aqui de novo. */
  config: unknown;
  /** Versão que a pessoa abriu (0 = ainda não existia). Outra versão gravada no meio dá `version_conflict`. */
  expectedVersion: number;
  userId: string;
  ceiling: ModerationCeiling;
}

/**
 * Grava a configuração de um escopo e o histórico na mesma transação. Recusa payload fora do formato ou acima do teto
 * (`invalid_moderation_config`, com os campos na mensagem) e versão velha (`version_conflict`).
 */
export async function saveModerationConfig(
  db: Database,
  input: SaveModerationInput,
): Promise<{ version: number }> {
  if (!isModerationScope(input.scope)) throw new CosmosError('invalid_moderation_config', 'escopo inválido');
  const parsed =
    input.scope.kind === 'tenant'
      ? parseModerationConfig(input.config, input.ceiling)
      : parseModerationConfig(input.config, input.ceiling, { partial: true });
  if (!parsed.ok) throw new CosmosError('invalid_moderation_config', parsed.errors.join(','));
  const { tenantId, scope, userId } = input;
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ version: moderationConfig.version })
      .from(moderationConfig)
      .where(
        and(
          eq(moderationConfig.tenantId, tenantId),
          eq(moderationConfig.scopeKind, scope.kind),
          eq(moderationConfig.scopeId, scope.id),
        ),
      )
      .for('update');
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== input.expectedVersion)
      throw new CosmosError(
        'version_conflict',
        `versão ${currentVersion}, esperada ${input.expectedVersion}`,
      );
    const version = currentVersion + 1;
    const config = parsed.value as Record<string, unknown>;
    // a primeira gravação de duas pessoas ao mesmo tempo: a segunda bate no índice único e vira conflito
    const written = await tx
      .insert(moderationConfig)
      .values({ tenantId, scopeKind: scope.kind, scopeId: scope.id, config, version, updatedBy: userId })
      .onConflictDoUpdate({
        target: [moderationConfig.tenantId, moderationConfig.scopeKind, moderationConfig.scopeId],
        set: { config, version, updatedBy: userId, updatedAt: new Date() },
        setWhere: eq(moderationConfig.version, currentVersion),
      })
      .returning({ version: moderationConfig.version });
    if (written.length === 0) throw new CosmosError('version_conflict', `versão mudou durante a gravação`);
    await tx.insert(moderationConfigLog).values({
      tenantId,
      scopeKind: scope.kind,
      scopeId: scope.id,
      version,
      config,
      changedBy: userId,
    });
    return { version };
  });
}

/** Tira a exceção de uma sala ou comunidade (volta a valer a do cliente), com registro no histórico. */
export async function removeModerationOverride(
  db: Database,
  input: { tenantId: string; scope: ModerationScope; expectedVersion: number; userId: string },
): Promise<void> {
  const { tenantId, scope, userId } = input;
  if (!isModerationScope(scope) || scope.kind === 'tenant')
    throw new CosmosError('invalid_moderation_config', 'escopo inválido');
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(moderationConfig)
      .where(
        and(
          eq(moderationConfig.tenantId, tenantId),
          eq(moderationConfig.scopeKind, scope.kind),
          eq(moderationConfig.scopeId, scope.id),
          eq(moderationConfig.version, input.expectedVersion),
        ),
      )
      .returning({ version: moderationConfig.version });
    if (removed.length === 0) throw new CosmosError('version_conflict', `exceção mudou ou já saiu`);
    await tx.insert(moderationConfigLog).values({
      tenantId,
      scopeKind: scope.kind,
      scopeId: scope.id,
      version: input.expectedVersion + 1,
      config: null,
      changedBy: userId,
    });
  });
}

export interface ModerationHistoryEntry {
  id: string;
  scope: ModerationScope;
  version: number;
  /** null = exceção removida. */
  config: ModerationConfig | ModerationOverride | null;
  changedBy: string;
  createdAt: Date;
}

/** Quem mudou e quando, do mais novo ao mais antigo; com `scope`, só daquele escopo. */
export async function listModerationHistory(
  db: Pick<Database, 'select'>,
  tenantId: string,
  options: { scope?: ModerationScope; limit?: number } = {},
): Promise<ModerationHistoryEntry[]> {
  const where = options.scope
    ? and(
        eq(moderationConfigLog.tenantId, tenantId),
        eq(moderationConfigLog.scopeKind, options.scope.kind),
        eq(moderationConfigLog.scopeId, options.scope.id),
      )
    : eq(moderationConfigLog.tenantId, tenantId);
  const rows = await db
    .select()
    .from(moderationConfigLog)
    .where(where)
    .orderBy(desc(moderationConfigLog.id))
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
  return rows.map((r) => ({
    id: r.id,
    scope: { kind: r.scopeKind, id: r.scopeId },
    version: r.version,
    config: r.config as ModerationConfig | ModerationOverride | null,
    changedBy: r.changedBy,
    createdAt: r.createdAt,
  }));
}
