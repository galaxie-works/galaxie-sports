/**
 * Auditoria das chaves de API (`api.api_key_event`): emissão, rotação, revogação e migração, com quem fez e
 * quando. Só o prefixo da chave, nunca o segredo (docs/politica-de-chaves.md §5).
 */
import { desc, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { apiKeyEvent } from './schema/index.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type KeyEventAction = 'issued' | 'rotated' | 'revoked' | 'migrated';

export interface KeyEventInput {
  tenantId: string;
  keyKind: 'secret' | 'publishable';
  keyId: string;
  prefix: string;
  action: KeyEventAction;
  /** `admin`, `tenant`, `cli:<comando>`, `panel:<id do usuário>`, `widget`. */
  actor: string;
  detail?: Record<string, unknown>;
}

/** Grava o evento (na mesma transação da mudança, quando recebe `tx`). */
export async function recordKeyEvent(db: Database | Tx, input: KeyEventInput): Promise<void> {
  await db.insert(apiKeyEvent).values({ ...input, detail: input.detail ?? null });
}

export type KeyEvent = typeof apiKeyEvent.$inferSelect;

/** Eventos do tenant, mais recentes primeiro. */
export async function listKeyEvents(db: Database, tenantId: string, limit = 100): Promise<KeyEvent[]> {
  return db
    .select()
    .from(apiKeyEvent)
    .where(eq(apiKeyEvent.tenantId, tenantId))
    .orderBy(desc(apiKeyEvent.createdAt), desc(apiKeyEvent.id))
    .limit(limit);
}
