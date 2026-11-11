/**
 * Permissões por cargo do tenant (#1019), só no servidor. A tabela `api.tenant_role_permission` guarda só o que o
 * Dono mudou da matriz `ACTIONS` de `@galaxie/engage`; sem linha, vale o padrão. Cada mudança entra na auditoria dos
 * cargos (`api.tenant_member_event`) na mesma transação.
 *
 * O `can()` continua síncrono: a sessão (`readClientContext`) lê a configuração uma vez por requisição e a põe no
 * `Actor`. Entre requisições, um cache curto em memória (`TTL_MS`) evita ler o banco a cada página; a gravação limpa
 * o cache do tenant neste processo, e os outros processos veem a mudança em até `TTL_MS`.
 */
import {
  diffOverrides,
  isTenantAction,
  isTenantRole,
  normalizeOverrides,
  setRolePermission,
  type PermissionChange,
  type RoleOverrides,
  type TenantAction,
  type TenantRole,
} from '@galaxie/engage';
import type { PoolClient } from 'pg';

import { pool } from '@/lib/auth/db';

import { isUuid } from './tenants';

/** Quanto a configuração lida fica em memória. Curto: tirar uma permissão vale em segundos em todos os processos. */
export const TTL_MS = 15_000;

const cache = new Map<string, { overrides: RoleOverrides | null; expires: number }>();

/** Banco sem a tabela (migrations atrasadas): vale a matriz padrão. */
const isMissingTable = (err: unknown) => (err as { code?: string }).code === '42P01';

/** Linhas do banco → configuração limpa (o que não for cargo, ação ou célula configurável é descartado). */
export function overridesFromRows(rows: { role: string; action: string; allowed: boolean }[]): RoleOverrides {
  const raw: RoleOverrides = {};
  for (const r of rows)
    if (isTenantRole(r.role) && isTenantAction(r.action)) (raw[r.role] ??= {})[r.action] = r.allowed;
  return normalizeOverrides(raw);
}

/** Configuração → linhas (uma por célula que difere do padrão). */
export function rowsFromOverrides(
  overrides: RoleOverrides,
): { role: TenantRole; action: TenantAction; allowed: boolean }[] {
  return Object.entries(overrides).flatMap(([role, actions]) =>
    Object.entries(actions ?? {}).map(([action, allowed]) => ({
      role: role as TenantRole,
      action: action as TenantAction,
      allowed: allowed as boolean,
    })),
  );
}

const isEmpty = (o: RoleOverrides) => Object.keys(o).length === 0;

async function readRows(
  q: Pick<PoolClient, 'query'>,
  tenantId: string,
): Promise<{ role: string; action: string; allowed: boolean }[]> {
  const { rows } = await q.query<{ role: string; action: string; allowed: boolean }>(
    `select role, action, allowed from api.tenant_role_permission where tenant_id = $1`,
    [tenantId],
  );
  return rows;
}

/**
 * Configuração do tenant; null = a matriz padrão (nada gravado). Lê do cache curto; `fresh` vai direto ao banco
 * (tela de permissões, logo depois de gravar).
 */
export async function loadRoleOverrides(
  tenantId: string,
  { fresh = false, now = Date.now() }: { fresh?: boolean; now?: number } = {},
): Promise<RoleOverrides | null> {
  if (!isUuid(tenantId)) return null;
  const hit = cache.get(tenantId);
  if (!fresh && hit && hit.expires > now) return hit.overrides;
  let overrides: RoleOverrides | null;
  try {
    const o = overridesFromRows(await readRows(pool, tenantId));
    overrides = isEmpty(o) ? null : o;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    overrides = null;
  }
  cache.set(tenantId, { overrides, expires: now + TTL_MS });
  return overrides;
}

/** Esquece a configuração lida do tenant (depois de gravar). */
export function invalidateRoleOverrides(tenantId: string) {
  cache.delete(tenantId);
}

async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Troca a configuração do tenant por `next(atual)` numa transação: trava o tenant (duas gravações ao mesmo tempo
 * não se perdem), regrava as linhas e registra na auditoria cada célula que mudou no efetivo. Devolve as mudanças.
 */
async function replaceOverrides(
  tenantId: string,
  actor: string,
  next: (current: RoleOverrides) => RoleOverrides,
): Promise<PermissionChange[]> {
  const changes = await tx(async (c) => {
    const { rowCount } = await c.query(`select 1 from api.tenant where id = $1 for update`, [tenantId]);
    if (!rowCount) return [];
    const current = overridesFromRows(await readRows(c, tenantId));
    const after = normalizeOverrides(next(current));
    const diff = diffOverrides(current, after);
    if (!diff.length) return [];
    await c.query(`delete from api.tenant_role_permission where tenant_id = $1`, [tenantId]);
    for (const r of rowsFromOverrides(after))
      await c.query(
        `insert into api.tenant_role_permission (tenant_id, role, action, allowed, updated_by)
         values ($1, $2, $3, $4, $5)`,
        [tenantId, r.role, r.action, r.allowed, actor],
      );
    for (const d of diff)
      await c.query(
        `insert into api.tenant_member_event (tenant_id, member_id, action, actor, to_role, subject)
         values ($1, null, $2, $3, $4, $5)`,
        [tenantId, d.allowed ? 'permission_granted' : 'permission_revoked', actor, d.role, d.action],
      );
    return diff;
  });
  invalidateRoleOverrides(tenantId);
  return changes;
}

/** Liga ou desliga uma ação num cargo (com a Escada: dar sobe, tirar desce). */
export function saveRolePermission(input: {
  tenantId: string;
  role: TenantRole;
  action: TenantAction;
  allowed: boolean;
  actor: string;
}): Promise<PermissionChange[]> {
  return replaceOverrides(input.tenantId, input.actor, (current) =>
    setRolePermission(current, input.role, input.action, input.allowed),
  );
}

/** Volta todas as permissões do tenant à matriz padrão. */
export function resetRolePermissions(input: {
  tenantId: string;
  actor: string;
}): Promise<PermissionChange[]> {
  return replaceOverrides(input.tenantId, input.actor, () => ({}));
}
