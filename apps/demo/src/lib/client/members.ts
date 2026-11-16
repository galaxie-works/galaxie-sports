/**
 * Usuários e cargos de um tenant (#1019) e da organização (#1136, F2), só no servidor. As tabelas são
 * `api.tenant_member` (cargo na marca) e `billing.organization_member` (Dono e Financeiro, que valem em todas as
 * marcas da organização), com a auditoria em `api.tenant_member_event` gravada na mesma transação. Quem pode o quê é
 * decidido antes, pelo `can()` de `@galaxie/engage`; aqui ficam só as travas que valem para todo mundo (sempre sobra
 * um Dono, Voluntário é Perfil, convite vencido não entra).
 */
import { isTenantRole, type MemberScope, type TenantRole } from '@galaxie/engage';
import type { PoolClient } from 'pg';

import { pool } from '@/lib/auth/db';

import { isUuid } from './tenants';

/**
 * Validade do convite (marca e organização), em dias: depois disso a pessoa não entra, e a tela Membros oferece
 * "convidar de novo", que gera prazo novo. Constante do código (doc 03, F2); não está em `runtime_setting` porque o
 * registro de chaves não tem uma seção do console. Entra lá quando a seção existir.
 */
export const INVITE_TTL_DAYS = 7;

/** Situação de um convite: aceito, à espera do primeiro acesso, ou vencido (não entra mais). */
export type InviteStatus = 'active' | 'pending' | 'expired';

export function inviteStatus(
  acceptedAt: string | Date | null,
  expiresAt: string | Date | null,
  now: Date = new Date(),
): InviteStatus {
  if (acceptedAt) return 'active';
  if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

/** De onde vem o cargo: da marca (`api.tenant_member`) ou da organização (`billing.organization_member`). */
export type MembershipSource = 'tenant' | 'organization';

/** Cargo de uma pessoa do console num tenant. */
export interface Membership {
  memberId: string;
  tenantId: string;
  role: TenantRole;
  scope: MemberScope | null;
  acceptedAt: string | null;
  source: MembershipSource;
}

/** Membro na tela de Usuários e cargos. */
export interface TenantMemberRow extends Membership {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  inviteExpiresAt: string | null;
  status: InviteStatus;
}

/** Cargos que valem na organização inteira (`billing.organization_member`). */
export type OrganizationMemberRole = 'owner' | 'billing';
export const ORGANIZATION_MEMBER_ROLES: readonly OrganizationMemberRole[] = ['owner', 'billing'];
export const isOrganizationMemberRole = (value: unknown): value is OrganizationMemberRole =>
  value === 'owner' || value === 'billing';

/** Membro da organização na tela de Usuários e cargos (seção "Valem em todas as marcas"). */
export interface OrganizationMemberRow {
  memberId: string;
  organizationId: string;
  userId: string;
  email: string;
  name: string;
  role: OrganizationMemberRole;
  invitedAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  status: InviteStatus;
}

/** A organização de uma marca, com as marcas dela (para a tela e para a auditoria por marca). */
export interface TenantOrganization {
  id: string;
  name: string;
  brands: { id: string; name: string }[];
}

export type MemberEventAction =
  | 'invited'
  | 'accepted'
  | 'role_changed'
  | 'scope_changed'
  | 'removed'
  /** Permissões por cargo: o cargo em `toRole`, a ação da matriz em `subject`. */
  | 'permission_granted'
  | 'permission_revoked';

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
  source?: MembershipSource;
}): Membership | null =>
  isTenantRole(r.role)
    ? {
        memberId: r.member_id,
        tenantId: r.tenant_id,
        role: r.role,
        scope: r.scope,
        acceptedAt: r.accepted_at?.toISOString() ?? null,
        source: r.source ?? 'tenant',
      }
    : null;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

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
    /** null = evento da organização (vale em todas as marcas) ou de permissão, sem linha em `tenant_member`. */
    memberId: string | null;
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
 * Cargos da pessoa em todos os tenants: os da marca (`tenant_member`) mais os da organização (Dono e Financeiro em
 * `organization_member` valem em todas as marcas dela; a linha da marca vence quando existe). O cliente de antes dos
 * cargos (só `user.tenant_id`) vira Dono do tenant dele no primeiro acesso, com registro na auditoria (`legacy`).
 * Marca o convite como aceito no primeiro acesso, só se ainda não venceu; vencido não entra na lista.
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
            and (invite_expires_at is null or invite_expires_at > now())
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
      // o convite da organização aceito vale em cada marca dela: um registro por marca
      const { rows: org } = await c.query<{ tenant_id: string }>(
        `with accepted as (
           update billing.organization_member set accepted_at = now(), updated_at = now()
            where user_id = $1 and accepted_at is null and (expires_at is null or expires_at > now())
            returning organization_id)
         select t.id::text as tenant_id from accepted a join api.tenant t on t.organization_id = a.organization_id`,
        [userId],
      );
      for (const r of org)
        await logEvent(c, {
          tenantId: r.tenant_id,
          memberId: null,
          action: 'accepted',
          actor: `panel:${userId}`,
        });
    });
    const { rows } = await pool.query(
      `select x.member_id, x.tenant_id, x.role, x.scope, x.accepted_at, x.source
         from (
           select m.id::text as member_id, m.tenant_id::text as tenant_id, m.role, m.scope, m.accepted_at,
                  'tenant' as source, t.name, t.slug
             from api.tenant_member m join api.tenant t on t.id = m.tenant_id
            where m.user_id = $1 and m.accepted_at is not null
           union all
           select om.id::text, t.id::text, om.role, null, om.accepted_at, 'organization', t.name, t.slug
             from billing.organization_member om join api.tenant t on t.organization_id = om.organization_id
            where om.user_id = $1 and om.accepted_at is not null
              and not exists (
                select 1 from api.tenant_member m2
                 where m2.tenant_id = t.id and m2.user_id = om.user_id and m2.accepted_at is not null)
         ) x
        order by x.name, x.slug`,
      [userId],
    );
    return rows.map(toMembership).filter((m): m is Membership => m !== null);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Equipe da marca (pessoas do console com cargo em `tenant_member`), do cargo mais alto ao mais baixo e por e-mail. */
export async function listTenantMembers(tenantId: string): Promise<TenantMemberRow[]> {
  if (!isUuid(tenantId)) return [];
  try {
    const { rows } = await pool.query(
      `select m.id::text as member_id, m.tenant_id::text as tenant_id, m.role, m.scope, m.accepted_at,
              m.invite_expires_at, m.user_id, u.email, u.name, m.created_at
         from api.tenant_member m join "user" u on u.id = m.user_id
        where m.tenant_id = $1
        order by array_position(
                   array['owner','admin','developer','billing','senior_moderator','moderator','volunteer'], m.role),
                 u.email`,
      [tenantId],
    );
    return rows
      .map((r) => {
        const m = toMembership(r);
        return m
          ? {
              ...m,
              userId: r.user_id,
              email: r.email,
              name: r.name,
              createdAt: r.created_at.toISOString(),
              inviteExpiresAt: iso(r.invite_expires_at),
              status: inviteStatus(r.accepted_at, r.invite_expires_at),
            }
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

/** Dá cargo a uma pessoa do console (convite com validade de `INVITE_TTL_DAYS`). Já ter cargo no tenant → `exists`. */
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
      `insert into api.tenant_member (tenant_id, user_id, role, scope, invited_by, invite_expires_at)
       values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
       on conflict (tenant_id, user_id) where user_id is not null do nothing
       returning id::text`,
      [input.tenantId, input.userId, input.role, input.scope, input.actor, INVITE_TTL_DAYS],
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

/**
 * Convida de novo quem ainda não entrou (convite pendente ou vencido): prazo novo de `INVITE_TTL_DAYS` e registro na
 * auditoria. Devolve o usuário, para o e-mail sair de novo. Convite já aceito → `notFound`.
 */
export async function reinviteTenantMember(input: {
  tenantId: string;
  memberId: string;
  actor: string;
}): Promise<{ userId: string }> {
  if (!isUuid(input.memberId)) throw new MemberError('notFound');
  return tx(async (c) => {
    const { rows } = await c.query<{ user_id: string; role: TenantRole; email: string | null }>(
      `update api.tenant_member m
          set invite_expires_at = now() + make_interval(days => $3), updated_at = now()
         from "user" u
        where m.tenant_id = $1 and m.id = $2 and m.accepted_at is null and u.id = m.user_id
        returning m.user_id, m.role, u.email`,
      [input.tenantId, input.memberId, INVITE_TTL_DAYS],
    );
    const cur = rows[0];
    if (!cur) throw new MemberError('notFound');
    await logEvent(c, {
      tenantId: input.tenantId,
      memberId: input.memberId,
      action: 'invited',
      actor: input.actor,
      toRole: cur.role,
      subject: cur.email,
    });
    return { userId: cur.user_id };
  });
}

/** Quantos Donos o tenant tem (com trava da linha, dentro da transação). */
async function owners(c: PoolClient, tenantId: string): Promise<number> {
  const { rows } = await c.query<{ id: string }>(
    // pessoa apagada do console (sem o usuário) e convite vencido não contam como Dono: `listMemberships` também
    // não os aceita, e a marca ficaria sem ninguém que a gerencie
    `select m.id from api.tenant_member m
      where m.tenant_id = $1 and m.role = 'owner'
        and (m.profile_id is not null or exists (select 1 from "user" u where u.id = m.user_id))
        and (m.accepted_at is not null or m.invite_expires_at is null or m.invite_expires_at > now())
      for update of m`,
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

/**
 * Tira os cargos de uma pessoa do console, com registro na auditoria. `tenantId` limita a um tenant; sem ele, todos
 * (a pessoa foi apagada do console). Ação da equipe Galaxie: não respeita a trava do último Dono, porque quem troca o
 * cliente de tenant ou apaga a conta é a Galaxie, e o tenant que ficar sem Dono recebe outro pela tela de cargos.
 */
export async function removeMembershipsOf(
  userId: string,
  actor: string,
  tenantId?: string | null,
): Promise<number> {
  if (tenantId !== undefined && (tenantId === null || !isUuid(tenantId))) return 0;
  try {
    return await tx(async (c) => {
      const { rows } = await c.query<{
        id: string;
        tenant_id: string;
        role: TenantRole;
        email: string | null;
      }>(
        `delete from api.tenant_member m
          where m.user_id = $1 and ($2::uuid is null or m.tenant_id = $2::uuid)
          returning m.id::text, m.tenant_id::text, m.role,
                    (select u.email from "user" u where u.id = m.user_id) as email`,
        [userId, tenantId ?? null],
      );
      for (const r of rows)
        await logEvent(c, {
          tenantId: r.tenant_id,
          memberId: r.id,
          action: 'removed',
          actor,
          fromRole: r.role,
          subject: r.email,
        });
      return rows.length;
    });
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

// ─── organização: Dono e Financeiro valem em todas as marcas (#1136, F2) ──────────────────────────

/** A organização da marca e as marcas dela; null = marca ainda sem organização (migration de dados não rodou). */
export async function getTenantOrganization(tenantId: string): Promise<TenantOrganization | null> {
  if (!isUuid(tenantId)) return null;
  try {
    const { rows } = await pool.query<{ id: string; name: string; brand_id: string; brand_name: string }>(
      `select o.id::text, o.name, b.id::text as brand_id, b.name as brand_name
         from api.tenant t
         join billing.organization o on o.id = t.organization_id
         join api.tenant b on b.organization_id = o.id
        where t.id = $1
        order by b.name, b.slug`,
      [tenantId],
    );
    const first = rows[0];
    if (!first) return null;
    return {
      id: first.id,
      name: first.name,
      brands: rows.map((r) => ({ id: r.brand_id, name: r.brand_name })),
    };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** Marcas da organização (ids), para a auditoria por marca. */
async function brandsOf(c: Pick<PoolClient, 'query'>, organizationId: string): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(
    `select id::text from api.tenant where organization_id = $1 order by name, slug`,
    [organizationId],
  );
  return rows.map((r) => r.id);
}

/** Evento da organização: uma linha em `tenant_member_event` por marca, sem `member_id` (a leitura é por marca). */
async function logOrganizationEvent(
  c: PoolClient,
  organizationId: string,
  e: {
    action: MemberEventAction;
    actor: string;
    fromRole?: TenantRole | null;
    toRole?: TenantRole | null;
    subject?: string | null;
  },
) {
  for (const tenantId of await brandsOf(c, organizationId))
    await logEvent(c, { tenantId, memberId: null, ...e });
}

/** Membros da organização, Donos primeiro e por e-mail. */
export async function listOrganizationMembers(organizationId: string): Promise<OrganizationMemberRow[]> {
  if (!isUuid(organizationId)) return [];
  try {
    const { rows } = await pool.query<{
      member_id: string;
      user_id: string;
      email: string;
      name: string;
      role: string;
      invited_at: Date;
      expires_at: Date | null;
      accepted_at: Date | null;
    }>(
      `select om.id::text as member_id, om.user_id, u.email, u.name, om.role, om.invited_at, om.expires_at,
              om.accepted_at
         from billing.organization_member om join "user" u on u.id = om.user_id
        where om.organization_id = $1
        order by array_position(array['owner','billing'], om.role), u.email`,
      [organizationId],
    );
    return rows
      .filter((r) => isOrganizationMemberRole(r.role))
      .map((r) => ({
        memberId: r.member_id,
        organizationId,
        userId: r.user_id,
        email: r.email,
        name: r.name,
        role: r.role as OrganizationMemberRole,
        invitedAt: r.invited_at.toISOString(),
        expiresAt: iso(r.expires_at),
        acceptedAt: iso(r.accepted_at),
        status: inviteStatus(r.accepted_at, r.expires_at),
      }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function getOrganizationMember(
  organizationId: string,
  memberId: string,
): Promise<OrganizationMemberRow | null> {
  if (!isUuid(memberId)) return null;
  return (await listOrganizationMembers(organizationId)).find((m) => m.memberId === memberId) ?? null;
}

/**
 * Quantos Donos a organização tem (com trava da linha, dentro da transação). Pessoa apagada do console e convite
 * vencido não contam: `listMemberships` não os aceita, e a organização ficaria sem ninguém que a gerencie.
 */
async function organizationOwners(c: PoolClient, organizationId: string): Promise<number> {
  const { rows } = await c.query<{ id: string }>(
    `select om.id from billing.organization_member om
      where om.organization_id = $1 and om.role = 'owner'
        and exists (select 1 from "user" u where u.id = om.user_id)
        and (om.accepted_at is not null or om.expires_at is null or om.expires_at > now())
      for update of om`,
    [organizationId],
  );
  return rows.length;
}

/** Convida uma pessoa do console para a organização (Dono ou Financeiro), com validade. Já ter cargo → `exists`. */
export async function addOrganizationMember(input: {
  organizationId: string;
  userId: string;
  email: string;
  role: OrganizationMemberRole;
  actor: string;
}): Promise<string> {
  return tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into billing.organization_member (organization_id, user_id, role, invited_by, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(days => $5))
       on conflict (organization_id, user_id) do nothing
       returning id::text`,
      [input.organizationId, input.userId, input.role, input.actor, INVITE_TTL_DAYS],
    );
    if (!rows[0]) throw new MemberError('exists');
    await logOrganizationEvent(c, input.organizationId, {
      action: 'invited',
      actor: input.actor,
      toRole: input.role,
      subject: input.email,
    });
    return rows[0].id;
  });
}

/** Troca o cargo na organização. O último Dono continua Dono. */
export async function changeOrganizationMember(input: {
  organizationId: string;
  memberId: string;
  role: OrganizationMemberRole;
  actor: string;
}): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ role: OrganizationMemberRole; email: string | null }>(
      `select om.role, u.email from billing.organization_member om left join "user" u on u.id = om.user_id
        where om.organization_id = $1 and om.id = $2 for update of om`,
      [input.organizationId, input.memberId],
    );
    const cur = rows[0];
    if (!cur) throw new MemberError('notFound');
    if (cur.role === input.role) return;
    if (cur.role === 'owner' && (await organizationOwners(c, input.organizationId)) <= 1)
      throw new MemberError('lastOwner');
    await c.query(
      `update billing.organization_member set role = $3, updated_at = now() where organization_id = $1 and id = $2`,
      [input.organizationId, input.memberId, input.role],
    );
    await logOrganizationEvent(c, input.organizationId, {
      action: 'role_changed',
      actor: input.actor,
      fromRole: cur.role,
      toRole: input.role,
      subject: cur.email,
    });
  });
}

/** Tira o cargo na organização. O último Dono não sai. */
export async function removeOrganizationMember(input: {
  organizationId: string;
  memberId: string;
  actor: string;
}): Promise<void> {
  await tx(async (c) => {
    const { rows } = await c.query<{ role: OrganizationMemberRole; email: string | null }>(
      `select om.role, u.email from billing.organization_member om left join "user" u on u.id = om.user_id
        where om.organization_id = $1 and om.id = $2 for update of om`,
      [input.organizationId, input.memberId],
    );
    const cur = rows[0];
    if (!cur) throw new MemberError('notFound');
    if (cur.role === 'owner' && (await organizationOwners(c, input.organizationId)) <= 1)
      throw new MemberError('lastOwner');
    await c.query(`delete from billing.organization_member where organization_id = $1 and id = $2`, [
      input.organizationId,
      input.memberId,
    ]);
    await logOrganizationEvent(c, input.organizationId, {
      action: 'removed',
      actor: input.actor,
      fromRole: cur.role,
      subject: cur.email,
    });
  });
}

/** Convida de novo para a organização (pendente ou vencido): prazo novo. Já aceito → `notFound`. */
export async function reinviteOrganizationMember(input: {
  organizationId: string;
  memberId: string;
  actor: string;
}): Promise<{ userId: string }> {
  if (!isUuid(input.memberId)) throw new MemberError('notFound');
  return tx(async (c) => {
    const { rows } = await c.query<{ user_id: string; role: OrganizationMemberRole; email: string | null }>(
      `update billing.organization_member om
          set expires_at = now() + make_interval(days => $3), updated_at = now()
         from "user" u
        where om.organization_id = $1 and om.id = $2 and om.accepted_at is null and u.id = om.user_id
        returning om.user_id, om.role, u.email`,
      [input.organizationId, input.memberId, INVITE_TTL_DAYS],
    );
    const cur = rows[0];
    if (!cur) throw new MemberError('notFound');
    await logOrganizationEvent(c, input.organizationId, {
      action: 'invited',
      actor: input.actor,
      toRole: cur.role,
      subject: cur.email,
    });
    return { userId: cur.user_id };
  });
}
