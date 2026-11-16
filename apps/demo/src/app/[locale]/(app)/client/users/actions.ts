'use server';

/**
 * Usuários e cargos do tenant (#1019). Cada ação resolve a sessão, o tenant e o cargo no servidor e decide pelo
 * `can()` / `canAssign()` de `@galaxie/engage`: id de membro, cargo ou tenant forjados no navegador não passam.
 */
import { canAssign, canReceive, isTenantAction, isTenantRole, type TenantRole } from '@galaxie/engage';
import { revalidatePath } from 'next/cache';

import { pool } from '@/lib/auth/db';
import { sendInvite } from '@/lib/auth/invite';
import { auth } from '@/lib/auth/server';
import {
  addOrganizationMember,
  addTenantMember,
  changeOrganizationMember,
  changeTenantMember,
  getOrganizationMember,
  getTenantMember,
  getTenantOrganization,
  isOrganizationMemberRole,
  MemberError,
  reinviteOrganizationMember,
  reinviteTenantMember,
  removeOrganizationMember,
  removeTenantMember,
} from '@/lib/client/members';
import { can, canManageOrganization } from '@/lib/client/permissions';
import { resetRolePermissions, saveRolePermission } from '@/lib/client/role-permissions';
import { withStaffAudit } from '@/lib/client/staff';
import { readClientContext } from '@/lib/client/session';
import { isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { isStaffRole } from '@/lib/auth/roles';

export interface MemberActionResult {
  ok: boolean;
  error?: string;
  /** Link da tela de login, quando o e-mail do convite não saiu. */
  link?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function texts() {
  const locale = await getRequestLocale();
  const client = getDictionary(locale).client;
  return { locale, client, m: client.members };
}

/** Sessão com tenant e permissão de cuidar dos cargos, ou o erro já traduzido. */
async function manager() {
  const ctx = await readClientContext();
  const { client, m, locale } = await texts();
  if (!ctx) return { error: client.errors.forbidden } as const;
  if (!ctx.tenant || !ctx.actor) return { error: client.errors.noTenant } as const;
  if (!can(ctx, 'members.manage')) return { error: client.errors.role } as const;
  // quem fez, na auditoria: equipe Galaxie ou alguém do painel do cliente
  const actor = isStaffRole(ctx.role) ? `galaxie:${ctx.userId}` : `panel:${ctx.userId}`;
  return { ctx, tenant: ctx.tenant, who: ctx.actor, actor, m, locale } as const;
}

const memberError = (m: Awaited<ReturnType<typeof texts>>['m'], err: unknown): MemberActionResult => {
  if (err instanceof MemberError) return { ok: false, error: m.errors[err.code] };
  throw err;
};

const done = () => revalidatePath('/client/users');

/** Sessão com a organização da marca em foco e permissão de cuidar dela, ou o erro já traduzido. */
async function organizationManager() {
  const ctx = await readClientContext();
  const { client, m, locale } = await texts();
  if (!ctx) return { error: client.errors.forbidden } as const;
  if (!ctx.tenant) return { error: client.errors.noTenant } as const;
  if (!canManageOrganization(ctx)) return { error: client.errors.role } as const;
  const organization = await getTenantOrganization(ctx.tenant.id);
  if (!organization) return { error: m.organization.errors.none } as const;
  const actor = isStaffRole(ctx.role) ? `galaxie:${ctx.userId}` : `panel:${ctx.userId}`;
  return { ctx, organization, actor, m, locale } as const;
}

/** Usuário do console para um convite: o existente (só cliente) ou um novo, sem senha e sem tenant gravado. */
async function userForInvite(
  email: string,
  name: string,
  locale: string,
  m: Awaited<ReturnType<typeof texts>>['m'],
): Promise<{ userId: string } | { error: string }> {
  const { rows } = await pool.query<{ id: string; role: string | null }>(
    'select id, role from "user" where lower(email) = $1',
    [email],
  );
  // conta da equipe Galaxie ou convidado da demo não vira membro de cliente pelo painel do cliente
  if (rows[0] && rows[0].role !== 'client') return { error: m.errors.otherAccount };
  if (rows[0]) return { userId: rows[0].id };
  // sem headers: chamada do servidor, já autorizada acima pelo can() (o plugin admin exige sessão de admin
  // só quando a chamada vem de uma requisição)
  const created = await auth.api.createUser({
    body: {
      email,
      name: name.slice(0, 200),
      role: 'client',
      data: { tenantId: null, accessExpiresAt: null, locale: isLocale(locale) ? locale : null },
    },
  });
  return { userId: created.user.id };
}

/** Convida uma pessoa para a equipe com um cargo. Conta nova nasce como cliente, sem tenant gravado nem prazo. */
export const inviteMember = withStaffAudit('members.invite', async (input: {
  email: string;
  name: string;
  role: string;
}): Promise<MemberActionResult> => {
  const r = await manager();
  if ('error' in r) return { ok: false, error: r.error };
  const { m } = r;
  const email = String(input.email ?? '')
    .trim()
    .toLowerCase();
  const name = String(input.name ?? '').trim();
  if (!EMAIL_RE.test(email)) return { ok: false, error: m.errors.invalidEmail };
  if (!name) return { ok: false, error: m.errors.nameRequired };
  if (!isTenantRole(input.role)) return { ok: false, error: m.errors.roleNotAllowed };
  if (input.role === 'volunteer') return { ok: false, error: m.errors.volunteerIsProfile };
  if (!canAssign(r.who, r.tenant.id, input.role)) return { ok: false, error: m.errors.roleNotAllowed };

  const user = await userForInvite(email, name, r.locale, m);
  if ('error' in user) return { ok: false, error: user.error };
  const { userId } = user;
  try {
    await addTenantMember({
      tenantId: r.tenant.id,
      userId,
      email,
      role: input.role,
      scope: null,
      actor: r.actor,
    });
  } catch (err) {
    return memberError(m, err);
  }
  const sent = await sendInvite(userId);
  done();
  return { ok: true, link: sent.link };
});

/** Troca o cargo de alguém da equipe (não acima do próprio cargo; o último Dono continua Dono). */
export const changeMemberRole = withStaffAudit('members.role_change', async (input: {
  memberId: string;
  role: string;
}): Promise<MemberActionResult> => {
  const r = await manager();
  if ('error' in r) return { ok: false, error: r.error };
  const { m } = r;
  if (!isTenantRole(input.role)) return { ok: false, error: m.errors.roleNotAllowed };
  const current = await getTenantMember(r.tenant.id, String(input.memberId ?? ''));
  if (!current) return { ok: false, error: m.errors.notFound };
  if (!canAssign(r.who, r.tenant.id, input.role as TenantRole, current.role))
    return { ok: false, error: m.errors.roleNotAllowed };
  try {
    await changeTenantMember({
      tenantId: r.tenant.id,
      memberId: current.memberId,
      role: input.role as TenantRole,
      scope: current.scope,
      actor: r.actor,
    });
  } catch (err) {
    return memberError(m, err);
  }
  done();
  return { ok: true };
});

/**
 * Liga ou desliga uma ação num cargo (permissões por cargo). Só quem tem `permissions.manage` (o Dono; a equipe
 * Galaxie passa por cima). Dono, ações fixas e cargo abaixo do piso da ação não mudam: o pedido forjado é recusado.
 */
export const changeRolePermission = withStaffAudit('permissions.change', async (input: {
  role: string;
  action: string;
  allowed: boolean;
}): Promise<MemberActionResult> => {
  const r = await manager();
  if ('error' in r) return { ok: false, error: r.error };
  const { m } = r;
  if (!can(r.ctx, 'permissions.manage')) return { ok: false, error: m.permissions.readOnly };
  if (!isTenantRole(input.role) || !isTenantAction(input.action) || !canReceive(input.role, input.action))
    return { ok: false, error: m.errors.notConfigurable };
  await saveRolePermission({
    tenantId: r.tenant.id,
    role: input.role,
    action: input.action,
    allowed: input.allowed === true,
    actor: r.actor,
  });
  done();
  return { ok: true };
});

/** Volta todas as permissões por cargo do tenant à matriz padrão. Só quem tem `permissions.manage`. */
export const resetPermissions = withStaffAudit('permissions.reset', async (): Promise<MemberActionResult> => {
  const r = await manager();
  if ('error' in r) return { ok: false, error: r.error };
  if (!can(r.ctx, 'permissions.manage')) return { ok: false, error: r.m.permissions.readOnly };
  await resetRolePermissions({ tenantId: r.tenant.id, actor: r.actor });
  done();
  return { ok: true };
});

/** Tira o acesso de alguém ao painel deste tenant. */
export const removeMember = withStaffAudit('members.remove', async (input: { memberId: string }): Promise<MemberActionResult> => {
  const r = await manager();
  if ('error' in r) return { ok: false, error: r.error };
  const { m } = r;
  const current = await getTenantMember(r.tenant.id, String(input.memberId ?? ''));
  if (!current) return { ok: false, error: m.errors.notFound };
  if (!canAssign(r.who, r.tenant.id, null, current.role))
    return { ok: false, error: m.errors.roleNotAllowed };
  try {
    await removeTenantMember({ tenantId: r.tenant.id, memberId: current.memberId, actor: r.actor });
  } catch (err) {
    return memberError(m, err);
  }
  done();
  return { ok: true };
});

/** Convida de novo quem ainda não entrou na marca (pendente ou vencido): prazo novo e e-mail de novo. */
export const reinviteMember = withStaffAudit('members.reinvite', async (input: {
  memberId: string;
}): Promise<MemberActionResult> => {
  const r = await manager();
  if ('error' in r) return { ok: false, error: r.error };
  const { m } = r;
  const current = await getTenantMember(r.tenant.id, String(input.memberId ?? ''));
  if (!current) return { ok: false, error: m.errors.notFound };
  if (current.status === 'active') return { ok: false, error: m.errors.notFound };
  if (!canAssign(r.who, r.tenant.id, current.role, current.role))
    return { ok: false, error: m.errors.roleNotAllowed };
  let userId: string;
  try {
    userId = (await reinviteTenantMember({ tenantId: r.tenant.id, memberId: current.memberId, actor: r.actor }))
      .userId;
  } catch (err) {
    return memberError(m, err);
  }
  const sent = await sendInvite(userId);
  done();
  return { ok: true, link: sent.link };
});

// ─── organização: Dono e Financeiro valem em todas as marcas (#1136, F2) ──────────────────────────

/** Convida uma pessoa para a organização inteira (Dono ou Financeiro). Só o Dono e a equipe Galaxie. */
export const inviteOrganizationMember = withStaffAudit('organization.invite', async (input: {
  email: string;
  name: string;
  role: string;
}): Promise<MemberActionResult> => {
  const r = await organizationManager();
  if ('error' in r) return { ok: false, error: r.error };
  const { m } = r;
  const email = String(input.email ?? '')
    .trim()
    .toLowerCase();
  const name = String(input.name ?? '').trim();
  if (!EMAIL_RE.test(email)) return { ok: false, error: m.errors.invalidEmail };
  if (!name) return { ok: false, error: m.errors.nameRequired };
  if (!isOrganizationMemberRole(input.role)) return { ok: false, error: m.errors.roleNotAllowed };
  const user = await userForInvite(email, name, r.locale, m);
  if ('error' in user) return { ok: false, error: user.error };
  try {
    await addOrganizationMember({
      organizationId: r.organization.id,
      userId: user.userId,
      email,
      role: input.role,
      actor: r.actor,
    });
  } catch (err) {
    return memberError(m, err);
  }
  const sent = await sendInvite(user.userId);
  done();
  return { ok: true, link: sent.link };
});

/** Troca o cargo na organização (Dono ↔ Financeiro). O último Dono continua Dono. */
export const changeOrganizationMemberRole = withStaffAudit('organization.role_change', async (input: {
  memberId: string;
  role: string;
}): Promise<MemberActionResult> => {
  const r = await organizationManager();
  if ('error' in r) return { ok: false, error: r.error };
  const { m } = r;
  if (!isOrganizationMemberRole(input.role)) return { ok: false, error: m.errors.roleNotAllowed };
  const current = await getOrganizationMember(r.organization.id, String(input.memberId ?? ''));
  if (!current) return { ok: false, error: m.errors.notFound };
  try {
    await changeOrganizationMember({
      organizationId: r.organization.id,
      memberId: current.memberId,
      role: input.role,
      actor: r.actor,
    });
  } catch (err) {
    return memberError(m, err);
  }
  done();
  return { ok: true };
});

/** Tira o cargo da organização (a pessoa perde o acesso a todas as marcas por ele). O último Dono não sai. */
export const removeOrganizationMemberAction = withStaffAudit('organization.remove', async (input: {
  memberId: string;
}): Promise<MemberActionResult> => {
  const r = await organizationManager();
  if ('error' in r) return { ok: false, error: r.error };
  const { m } = r;
  const current = await getOrganizationMember(r.organization.id, String(input.memberId ?? ''));
  if (!current) return { ok: false, error: m.errors.notFound };
  try {
    await removeOrganizationMember({ organizationId: r.organization.id, memberId: current.memberId, actor: r.actor });
  } catch (err) {
    return memberError(m, err);
  }
  done();
  return { ok: true };
});

/** Convida de novo para a organização quem ainda não entrou: prazo novo e e-mail de novo. */
export const reinviteOrganizationMemberAction = withStaffAudit('organization.reinvite', async (input: {
  memberId: string;
}): Promise<MemberActionResult> => {
  const r = await organizationManager();
  if ('error' in r) return { ok: false, error: r.error };
  const { m } = r;
  const current = await getOrganizationMember(r.organization.id, String(input.memberId ?? ''));
  if (!current || current.status === 'active') return { ok: false, error: m.errors.notFound };
  let userId: string;
  try {
    userId = (
      await reinviteOrganizationMember({ organizationId: r.organization.id, memberId: current.memberId, actor: r.actor })
    ).userId;
  } catch (err) {
    return memberError(m, err);
  }
  const sent = await sendInvite(userId);
  done();
  return { ok: true, link: sent.link };
});
