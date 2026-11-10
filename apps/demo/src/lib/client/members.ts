/**
 * Usuários e cargos de um tenant (#1019), só no servidor. A tabela é `api.tenant_member`, com a auditoria em
 * `api.tenant_member_event` gravada na mesma transação. Quem pode o quê é decidido antes, pelo `can()` de
 * `@galaxie/engage`; aqui ficam só as travas que valem para todo mundo (sempre sobra um Dono, Voluntário é Perfil).
 */
import { isTenantRole, type MemberScope, type TenantRole } from '@galaxie/engage';
import type { PoolClient } from 'pg';

import { pool } from '@/lib/auth/db';

import { isUuid } from './tenants';

/** Cargo de uma pessoa do console num tenant. */
export interface Membership {
  memberId: string;
  tenantId: string;
  role: TenantRole;
  scope: MemberScope | null;
  acceptedAt: string | null;
}

/** Membro na tela de Usuários e cargos. */
export interface TenantMemberRow extends Membership {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
}

export type MemberEventAction = 'invited' | 'accepted' | 'role_changed' | 'scope_changed' | 'removed';

export interface MemberEvent {
  id: number;
  action: MemberEventAction;
  actor: string;
  fromRole: TenantRole | null;
  toRole: TenantRole | null;
  subject: string | null;
  createdAt: string;
}

/** Recusa das travas de cargo (o painel traduz pelo código). */
export class MemberError extends Error {
  constructor(readonly code: 'lastOwner' | 'notFound' | 'exists' | 'volunteerIsProfile') {
    super(code);
    this.name = 'MemberError';
  }
}

/** Banco sem as tabelas (migrations atrasadas): o painel segue, sem cargos. */
const isMissingTable = (err: unknown) => (err as { code?: string }).code === '42P01';

const toMembership = (r: {
  member_id: string;
  tenant_id: string;
  role: string;
  scope: MemberScope | null;
  accepted_at: Date | null;
}): Membership | null =>
  isTenantRole(r.role)
    ? {
        memberId: r.member_id,
        tenantId: r.tenant_id,
        role: r.role,
        scope: r.scope,
        acceptedAt: r.accepted_at?.toISOString() ?? null,
      }
    : null;

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

async function logEvent(
  c: PoolClient,
  e: {
    tenantId: string;
    memberId: string;
    action: MemberEventAction;
    actor: string;
    fromRole?: TenantRole | null;
    toRole?: TenantRole | null;
    subject?: string | null;
  },
) {
  await c.query(
    `insert into api.tenant_member_event (tenant_id, member_id, action, actor, from_role, to_role, subject)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [e.tenantId, e.memberId, e.action, e.actor, e.fromRole ?? null, e.toRole ?? null, e.subject ?? null],
  );
}

/**
 * Cargos da pessoa em todos os tenants. O cliente de antes dos cargos (só `user.tenant_id`) vira Dono do tenant dele
 * no primeiro acesso, com registro na auditoria (`legacy`). Marca o convite como aceito no primeiro acesso.
 */
export async function listMemberships(userId: string, legacyTenantId: string | null): Promise<Membership[]> {
  try {
    if (legacyTenantId && isUuid(legacyTenantId)) {
      await tx(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into api.tenant_member (tenant_id, user_id, role, invited_by, accepted_at)
           select $1, $2, 'owner', 'legacy', now()
            where exists (select 1 from api.tenant where id = $1)
           on conflict (tenant_id, user_id) where user_id is not null do nothing
           returning id::text`,
          [legacyTenantId, userId],
        );
        if (rows[0])
          await logEvent(c, {
            tenantId: legacyTenantId,
            memberId: rows[0].id,
            action: 'invited',
            actor: 'legacy',
            toRole: 'owner',
            subject: null,
          });
      });
    }
    await tx(async (c) => {
      const { rows } = await c.query<{ id: string; tenant_id: string }>(
        `update api.tenant_member set accepted_at = now(), updated_at = now()
          where user_id = $1 and accepted_at is null
          returning id::text, tenant_id::text`,
        [userId],
      );
      for (const r of rows)
        await logEvent(c, {
          tenantId: r.tenant_id,
          memberId: r.id,
          action: 'accepted',
          actor: `panel:${userId}`,
        });
    });
    const { rows } = await pool.query(
      `select m.id::text as member_id, m.tenant_id::text as tenant_id, m.role, m.scope, m.accepted_at
         from api.tenant_member m join api.tenant t on t.id = m.tenant_id
        where m.user_id = $1
        order by t.name, t.slug`,
      [userId],
    );
    return rows.map(toMembership).filter((m): m is Membership => m !== null);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Equipe do tenant (pessoas do console), do cargo mais alto ao mais baixo e por e-mail. */
export async function listTenantMembers(tenantId: string): Promise<TenantMemberRow[]> {
  if (!isUuid(tenantId)) return [];
  try {
    const { rows } = await pool.query(
      `select m.id::text as member_id, m.tenant_id::text as tenant_id, m.role, m.scope, m.accepted_at,
              m.user_id, u.email, u.name, m.created_at
         from api.tenant_member m join "user" u on u.id = m.user_id
        where m.tenant_id = $1
        order by array_position(array['owner','admin','senior_moderator','moderator','volunteer'], m.role), u.email`,
      [tenantId],
    );
    return rows
      .map((r) => {
        const m = toMembership(r);
        return m
          ? { ...m, userId: r.user_id, email: r.email, name: r.name, createdAt: r.created_at.toISOString() }
          : null;
      })
      .filter((m): m is TenantMemberRow => m !== null);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Um membro do tenant (para conferir o cargo atual antes de trocar ou tirar). */
export async function getTenantMember(tenantId: string, memberId: string): Promise<TenantMemberRow | null> {
  if (!isUuid(memberId)) return null;
  return (await listTenantMembers(tenantId)).find((m) => m.memberId === memberId) ?? null;
}

/** Dá cargo a uma pessoa do console (convite). Já ter cargo no tenant → `exists`. */
export async function addTenantMember(input: {
  tenantId: string;
  userId: string;
  email: string;
  role: TenantRole;
  scope: MemberScope | null;
  actor: string;
}): Promise<string> {
  if (input.role === 'volunteer') throw new MemberError('volunteerIsProfile');
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into api.tenant_member (tenant_id, user_id, role, scope, invited_by)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, user_id) where user_id is not null do nothing
       returning id::text`,
      [input.tenantId, input.userId, input.role, input.scope, input.actor],
    );
    if (!rows[0]) throw new MemberError('exists');
    await logEvent(c, {
      tenantId: input.tenantId,
      memberId: rows[0].id,
      action: 'invited',
      actor: input.actor,
      toRole: input.role,
      subject: input.email,
    });
    return rows[0].id;
  });
}

/** Quantos Donos o tenant tem (com trava da linha, dentro da transação). */
async function owners(c: PoolClient, tenantId: string): Promise<number> {
  const { rows } = await c.query<{ id: string }>(
    `select id from api.tenant_member where tenant_id = $1 and role = 'owner' for update`,
    [tenantId],
  );
  return rows.length;
}

/** Troca o cargo (e o escopo). O último Dono não deixa de ser Dono. */
export async function changeTenantMember(input: {
  tenantId: string;
  memberId: string;
  role: TenantRole;
  scope: MemberScope | null;
  actor: string;
}): Promise<void> {
  if (input.role === 'volunteer') throw new MemberError('volunteerIsProfile');
  await tx(async (c) => {
    const { rows } = await c.query<{ role: TenantRole; scope: MemberScope | null; email: string | null }>(
      `select m.role, m.scope, u.email from api.tenant_member m left join "user" u on u.id = m.user_id
        where m.tenant_id = $1 and m.id = $2 for update of m`,
      [input.tenantId, input.memberId],
    );
    const cur = rows[0];
    if (!cur) throw new MemberError('notFound');
    if (cur.role === 'owner' && input.role !== 'owner' && (await owners(c, input.tenantId)) <= 1)
      throw new MemberError('lastOwner');
    await c.query(
      `update api.tenant_member set role = $3, scope = $4, updated_at = now() where tenant_id = $1 and id = $2`,
      [input.tenantId, input.memberId, input.role, input.scope],
    );
    if (cur.role !== input.role)
      await logEvent(c, {
        tenantId: input.tenantId,
        memberId: input.memberId,
        action: 'role_changed',
        actor: input.actor,
        fromRole: cur.role,
        toRole: input.role,
        subject: cur.email,
      });
    if (JSON.stringify(cur.scope ?? null) !== JSON.stringify(input.scope ?? null))
      await logEvent(c, {
        tenantId: input.tenantId,
        memberId: input.memberId,
        action: 'scope_changed',
        actor: input.actor,
        fromRole: cur.role,
        toRole: input.role,
        subject: cur.email,
      });
  });
}

/** Tira o cargo. O último Dono não sai. */
export async function removeTenantMember(input: { tenantId: string; memberId: string; actor: string }) {
  await tx(async (c) => {
    const { rows } = await c.query<{ role: TenantRole; email: string | null }>(
      `select m.role, u.email from api.tenant_member m left join "user" u on u.id = m.user_id
        where m.tenant_id = $1 and m.id = $2 for update of m`,
      [input.tenantId, input.memberId],
    );
    const cur = rows[0];
    if (!cur) throw new MemberError('notFound');
    if (cur.role === 'owner' && (await owners(c, input.tenantId)) <= 1) throw new MemberError('lastOwner');
    const { rows: gone } = await c.query<{ user_id: string | null }>(
      `delete from api.tenant_member where tenant_id = $1 and id = $2 returning user_id`,
      [input.tenantId, input.memberId],
    );
    // o tenant gravado no usuário (cliente de antes dos cargos) faria a pessoa voltar como Dono no próximo acesso
    if (gone[0]?.user_id)
      await c.query(`update "user" set tenant_id = null where id = $1 and tenant_id = $2`, [
        gone[0].user_id,
        input.tenantId,
      ]);
    await logEvent(c, {
      tenantId: input.tenantId,
      memberId: input.memberId,
      action: 'removed',
      actor: input.actor,
      fromRole: cur.role,
      subject: cur.email,
    });
  });
}

/** Auditoria dos cargos do tenant, do mais novo ao mais antigo. */
export async function listMemberEvents(tenantId: string, limit = 50): Promise<MemberEvent[]> {
  if (!isUuid(tenantId)) return [];
  try {
    const { rows } = await pool.query(
      `select id, action, actor, from_role, to_role, subject, created_at
         from api.tenant_member_event where tenant_id = $1 order by created_at desc, id desc limit $2`,
      [tenantId, limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      action: r.action,
      actor: r.actor,
      fromRole: r.from_role,
      toRole: r.to_role,
      subject: r.subject,
      createdAt: r.created_at.toISOString(),
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}
