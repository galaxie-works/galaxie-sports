import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { apiKey, tenant, type Database } from '@galaxie/db';
import { createApiKey } from '../auth/admin.js';
import type { KeyEnv } from '../auth/keys.js';

/**
 * Migração das chaves secretas de formato 1 (sem checksum, ambiente das anteriores à 0007 desconhecido —
 * item C18) para o formato 2: cada chave legada válida é revogada e substituída por uma nova com o mesmo
 * tenant, rótulo, escopos e validade (docs/runbooks/migracao-de-chaves.md). O ambiente gravado das legadas
 * pode estar errado (a 0007 marcou todas como `live`): `testPrefixes` diz quais eram de teste.
 */
export interface LegacyKeyPlan {
  keyId: string;
  tenant: string;
  prefix: string;
  label: string | null;
  /** Ambiente gravado no banco. */
  storedEnv: KeyEnv;
  /** Ambiente da chave nova (o gravado, ou `test` se o prefixo estiver em `testPrefixes`). */
  newEnv: KeyEnv;
  lastUsedAt: Date | null;
}

export interface MigratedKey extends LegacyKeyPlan {
  /** Chave nova completa: exibida uma única vez. */
  newKey: string;
  newPrefix: string;
}

const legacyActive = (now: Date) =>
  and(
    eq(apiKey.keyFormat, 1),
    or(isNull(apiKey.revokedAt), gt(apiKey.revokedAt, now)),
    or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, now)),
  );

/** O que `applyKeyMigration` faria, sem mudar nada (`--plan`). */
export async function planKeyMigration(
  db: Database,
  options: { testPrefixes?: readonly string[]; now?: Date } = {},
): Promise<LegacyKeyPlan[]> {
  const now = options.now ?? new Date();
  const test = new Set(options.testPrefixes ?? []);
  const rows = await db
    .select({ key: apiKey, slug: tenant.slug })
    .from(apiKey)
    .innerJoin(tenant, eq(tenant.id, apiKey.tenantId))
    .where(legacyActive(now))
    .orderBy(asc(tenant.slug), asc(apiKey.createdAt));
  return rows.map(({ key, slug }) => ({
    keyId: key.id,
    tenant: slug,
    prefix: key.prefix,
    label: key.label,
    storedEnv: key.env,
    newEnv: test.has(key.prefix) ? 'test' : key.env,
    lastUsedAt: key.lastUsedAt,
  }));
}

/**
 * Revoga cada chave legada válida e emite a substituta, uma transação por chave (a antiga só sai se a
 * nova foi criada). Idempotente: rodar de novo não encontra mais chaves de formato 1 válidas. O teto por
 * ambiente não se aplica aqui (cada troca é uma por uma).
 */
export async function applyKeyMigration(
  db: Database,
  options: { testPrefixes?: readonly string[]; now?: Date } = {},
): Promise<MigratedKey[]> {
  const now = options.now ?? new Date();
  const out: MigratedKey[] = [];
  for (const plan of await planKeyMigration(db, options)) {
    const migrated = await db.transaction(async (tx) => {
      const [old] = await tx
        .update(apiKey)
        .set({ revokedAt: now })
        .where(and(eq(apiKey.id, plan.keyId), legacyActive(now)))
        .returning();
      if (!old) return null; // revogada por outro caminho no meio do caminho
      const created = await createApiKey(tx, old.tenantId, {
        env: plan.newEnv,
        ...(old.label ? { label: old.label } : {}),
        ...(old.scopes ? { scopes: old.scopes } : {}),
        ...(old.expiresAt ? { expiresAt: old.expiresAt } : {}),
      });
      return { ...plan, newKey: created.key, newPrefix: created.prefix };
    });
    if (migrated) out.push(migrated);
  }
  return out;
}
