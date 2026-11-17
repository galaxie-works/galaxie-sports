/**
 * `transitionTenantState`: a única função que escreve `api.tenant.state` (F3, decisão 2). Numa transação: trava a
 * linha do tenant, confere a transição pela tabela do diagrama, grava o evento em `billing.tenant_state_event`,
 * atualiza `state`, `state_since` e o espelho de `status`, e publica `tenant.state_changed` no `ops.change_feed`.
 * Chamada com o banco (`Database`), abre a própria transação e, depois do commit, invalida o cache de direitos quando
 * quem chama tem o cache (a API); sem ele, o TTL de um minuto cobre. Chamada com uma transação aberta (`Tx`), vira um
 * savepoint dela e **não aceita `entitlements`**: a invalidação rodaria antes do commit e o próximo leitor recolocaria
 * o estado antigo no cache. Quem precisa dos dois invalida depois do próprio commit.
 */
import { eq } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { publishChange } from '@galaxie/db/change-feed';
import type { Database } from '@galaxie/db/client';
import { tenant, tenantStateEvent, type TenantState, type TenantStateEventCause } from '@galaxie/db/schema';
import type { Catalog } from '../catalog/catalog.js';
import { invalidateEntitlements, type EntitlementsCacheStore } from '../entitlements/load.js';
import { canTransition, isTenantState } from './state.js';

/** Transação aberta do Drizzle (o mesmo tipo que `provisionOrganization` usa). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/**
 * O banco ou uma transação já aberta: dentro de uma transação, a mudança vira savepoint dela (e `entitlements` não
 * pode ser passado, ver `assertInvalidationAllowed`).
 */
export type TenantStateExecutor = Database | Tx;

/** Tópico publicado no `ops.change_feed` a cada mudança de estado (webhooks e console ouvem por ele). */
export const TENANT_STATE_CHANGED_TOPIC = 'tenant.state_changed';

export type TenantStateErrorCode = 'not_found' | 'invalid_state' | 'invalid_transition' | 'wrong_state';

/** Recusa da máquina de estados; `invalid_transition` traz o estado atual e o pedido. */
export class TenantStateError extends Error {
  constructor(
    readonly code: TenantStateErrorCode,
    readonly tenantId: string,
    readonly from: TenantState | null = null,
    readonly to: TenantState | null = null,
  ) {
    super(
      code === 'not_found'
        ? `Tenant ${tenantId} não existe.`
        : code === 'invalid_state'
          ? `Estado desconhecido para o tenant ${tenantId}: ${String(to)}.`
          : code === 'wrong_state'
            ? `Tenant ${tenantId} está em ${String(from)}; esta ação só vale em ${String(to)}.`
            : `Transição inválida para o tenant ${tenantId}: ${String(from)} → ${String(to)}.`,
    );
    this.name = 'TenantStateError';
  }
}

/**
 * Cache de direitos a invalidar depois do commit (a API passa o Valkey e o catálogo; a demo não tem cache). Só vale com
 * o executor `Database`: com `Tx` a função lança, porque invalidaria antes do commit.
 */
export interface EntitlementsInvalidation {
  cache: EntitlementsCacheStore | null | undefined;
  catalog: Pick<Catalog, 'version'>;
}

export interface TransitionInput {
  cause: TenantStateEventCause;
  /** `signup:<id>`, `galaxie:<id do usuário>`, `job:tenant.lifecycle`, `api:admin`, `migration:<número>`. */
  actor: string;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  now?: Date;
  entitlements?: EntitlementsInvalidation | null;
}

export interface TransitionResult {
  tenantId: string;
  from: TenantState;
  to: TenantState;
  stateSince: Date;
  eventId: string;
}

async function lockTenant(tx: Tx, tenantId: string) {
  const [row] = await tx
    .select({ id: tenant.id, state: tenant.state, trialEndsAt: tenant.trialEndsAt })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .for('update');
  if (!row) throw new TenantStateError('not_found', tenantId);
  return row;
}

/** `entitlements` com uma transação aberta é erro de programação: a invalidação rodaria antes do commit. */
function assertInvalidationAllowed(
  db: TenantStateExecutor,
  input: Pick<TransitionInput, 'entitlements'>,
): void {
  if (input.entitlements && db instanceof PgTransaction)
    throw new Error(
      'transitionTenantState/extendTenantTrial: a invalidação de direitos (entitlements) só vale com o banco, não com uma transação aberta; invalide depois do commit.',
    );
}

/** `status` em espelho (decisão 1): `suspended` só quando o estado é `suspended`. */
export const mirroredStatus = (state: TenantState): 'active' | 'suspended' =>
  state === 'suspended' ? 'suspended' : 'active';

/**
 * Muda o estado do tenant. Lança `TenantStateError` se o tenant não existe, o estado é desconhecido ou a transição
 * não está no diagrama; nada é gravado nesses casos.
 */
export async function transitionTenantState(
  db: TenantStateExecutor,
  tenantId: string,
  to: TenantState,
  input: TransitionInput,
): Promise<TransitionResult> {
  if (!isTenantState(to)) throw new TenantStateError('invalid_state', tenantId, null, to);
  assertInvalidationAllowed(db, input);
  const now = input.now ?? new Date();
  const result = await db.transaction(async (tx) => {
    const row = await lockTenant(tx, tenantId);
    if (!canTransition(row.state, to))
      throw new TenantStateError('invalid_transition', tenantId, row.state, to);
    const [event] = await tx
      .insert(tenantStateEvent)
      .values({
        tenantId,
        fromState: row.state,
        toState: to,
        cause: input.cause,
        reason: input.reason ?? null,
        actor: input.actor,
        payload: input.payload ?? null,
        createdAt: now,
      })
      .returning({ id: tenantStateEvent.id });
    await tx
      .update(tenant)
      .set({ state: to, stateSince: now, status: mirroredStatus(to), updatedAt: now })
      .where(eq(tenant.id, tenantId));
    await publishChange(tx, {
      topic: TENANT_STATE_CHANGED_TOPIC,
      entityType: 'tenant',
      entityId: tenantId,
      payload: {
        tenant_id: tenantId,
        from: row.state,
        to,
        cause: input.cause,
        reason: input.reason ?? null,
        actor: input.actor,
        state_since: now.toISOString(),
      },
    });
    return { tenantId, from: row.state, to, stateSince: now, eventId: event!.id };
  });
  if (input.entitlements)
    await invalidateEntitlements(input.entitlements.cache, input.entitlements.catalog, tenantId);
  return result;
}

/**
 * Registra a criação do tenant em `draft` (evento com `from_state` nulo). O provisionamento chama logo depois do
 * `insert`, na mesma transação, antes de levar a marca a `trial` ou `pending_review` (decisão 6).
 */
export async function recordTenantCreated(
  db: TenantStateExecutor,
  tenantId: string,
  input: Pick<TransitionInput, 'cause' | 'actor' | 'reason' | 'payload' | 'now'>,
): Promise<string> {
  const [event] = await db
    .insert(tenantStateEvent)
    .values({
      tenantId,
      fromState: null,
      toState: 'draft',
      cause: input.cause,
      reason: input.reason ?? null,
      actor: input.actor,
      payload: input.payload ?? null,
      // relógio do processo, o mesmo de transitionTenantState (o do banco pode estar adiantado): a ordem dos eventos fica certa
      createdAt: input.now ?? new Date(),
    })
    .returning({ id: tenantStateEvent.id });
  return event!.id;
}

/**
 * Estende o trial (decisão 7): muda `trial_ends_at` de um tenant em `trial` e grava um evento `admin` sem mudar o
 * estado (`from_state = to_state = 'trial'`, com o prazo antes e depois no payload). Fora de `trial`, lança.
 */
export async function extendTenantTrial(
  db: TenantStateExecutor,
  tenantId: string,
  trialEndsAt: Date,
  input: Omit<TransitionInput, 'cause' | 'payload'>,
): Promise<{ tenantId: string; before: Date | null; after: Date; eventId: string }> {
  assertInvalidationAllowed(db, input);
  const now = input.now ?? new Date();
  const result = await db.transaction(async (tx) => {
    const row = await lockTenant(tx, tenantId);
    if (row.state !== 'trial') throw new TenantStateError('wrong_state', tenantId, row.state, 'trial');
    const [event] = await tx
      .insert(tenantStateEvent)
      .values({
        tenantId,
        fromState: 'trial',
        toState: 'trial',
        cause: 'admin',
        reason: input.reason ?? null,
        actor: input.actor,
        payload: {
          trial_ends_at: { before: row.trialEndsAt?.toISOString() ?? null, after: trialEndsAt.toISOString() },
        },
        createdAt: now,
      })
      .returning({ id: tenantStateEvent.id });
    await tx.update(tenant).set({ trialEndsAt, updatedAt: now }).where(eq(tenant.id, tenantId));
    return { tenantId, before: row.trialEndsAt, after: trialEndsAt, eventId: event!.id };
  });
  if (input.entitlements)
    await invalidateEntitlements(input.entitlements.cache, input.entitlements.catalog, tenantId);
  return result;
}
