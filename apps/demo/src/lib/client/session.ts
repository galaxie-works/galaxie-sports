/**
 * Quem está no painel do cliente e de qual tenant (só no servidor). O tenant nunca vem do navegador:
 * o cliente tem o dele gravado no usuário (`tenant_id`, só o admin muda); o admin escolhe qual tenant
 * acompanhar e a escolha fica num cookie, conferida aqui a cada leitura. Toda página, ação e rota do
 * painel passa por aqui (o proxy é só a primeira barreira).
 */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { canAccessClientPanel, roleOf } from '@/lib/auth/roles';
import { auth, isAccessExpired } from '@/lib/auth/server';

import type { Actor, TenantRole } from '@galaxie/engage';

import { listMemberships, type MembershipSource } from './members';
import { loadRoleOverrides } from './role-permissions';
import { decodeStaffReason, STAFF_REASON_COOKIE } from './staff-reason';
import { getTenantInfo, listTenantOptions, type TenantInfo, type TenantOption } from './tenants';

/** Tenant que o admin está acompanhando no painel do cliente. */
export const TENANT_COOKIE = 'galaxie-tenant';

export interface ClientContext {
  userId: string;
  email: string;
  /** `admin` e `support` são a equipe Galaxie (`isStaffRole`); `client` é a pessoa do cliente com cargo. */
  role: 'admin' | 'support' | 'client';
  /** Tenant em foco; null = cliente sem tenant (convite incompleto) ou nenhum tenant no banco. */
  tenant: TenantInfo | null;
  /** Tenants que a pessoa pode escolher: todos para a equipe; para o cliente, os em que tem cargo (marca ou organização). */
  tenants: TenantOption[];
  /** Cargo no tenant em foco (#1019); null para a equipe da Galaxie ou sem tenant. */
  memberRole: TenantRole | null;
  /**
   * De onde vem o cargo em foco: da marca (`api.tenant_member`) ou da organização (`billing.organization_member`,
   * que vale em todas as marcas). Só o Dono vindo da organização cuida dos cargos dela; null sem cargo.
   */
  memberSource: MembershipSource | null;
  /** Quem age, para o `can()` de `@galaxie/engage`; null = sem tenant em foco. */
  actor: Actor | null;
  /**
   * Motivo em vigor da equipe Galaxie no tenant em foco (cookie assinado, 8 h); null para o cliente, no tenant da
   * Galaxie, ou quando a equipe ainda não informou (aí nenhuma escrita passa: `lib/client/staff.ts`).
   */
  staffReason: string | null;
}

/**
 * Contexto do painel, ou null quando a sessão não abre o painel (sem sessão, vencida ou outro papel).
 * Uma leitura por requisição (`cache`): a página e a moldura do painel pedem o mesmo contexto.
 */
export const readClientContext = cache(async (): Promise<ClientContext | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAccessExpired(session.user)) return null;
  const role = roleOf(session.user.role);
  if (!canAccessClientPanel(role)) return null;
  const base = { userId: session.user.id, email: session.user.email };

  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;

  if (role === 'client') {
    // o cliente de antes dos cargos (só `tenant_id` no usuário) vira Dono do tenant dele no primeiro acesso
    const legacyTenantId = (session.user as { tenantId?: string | null }).tenantId ?? null;
    const memberships = await listMemberships(session.user.id, legacyTenantId);
    const all = await listTenantOptions();
    const tenants = all.filter((t) => memberships.some((m) => m.tenantId === t.id));
    const member = memberships.find((m) => m.tenantId === chosen) ?? memberships[0] ?? null;
    const tenant = member ? await getTenantInfo(member.tenantId) : null;
    // permissões por cargo que o Dono mudou (cache curto); sem configuração, o `can()` usa a matriz padrão
    const overrides = tenant && member ? await loadRoleOverrides(tenant.id) : null;
    return {
      ...base,
      role: 'client',
      tenant,
      tenants,
      memberRole: tenant && member ? member.role : null,
      memberSource: tenant && member ? member.source : null,
      actor:
        tenant && member
          ? {
              kind: 'member',
              tenantId: tenant.id,
              role: member.role,
              scope: member.scope,
              ...(overrides ? { overrides } : {}),
            }
          : null,
      staffReason: null,
    };
  }

  // equipe Galaxie (admin ou support): qualquer tenant, e o `can()` passa por cima; fora do tenant da Galaxie, toda
  // escrita leva motivo (`lib/client/staff.ts`)
  const tenants = await listTenantOptions();
  const id = tenants.find((t) => t.id === chosen)?.id ?? tenants[0]?.id ?? null;
  const tenant = id ? await getTenantInfo(id) : null;
  const staffReason =
    tenant && !tenant.isGalaxie
      ? (decodeStaffReason(
          process.env.BETTER_AUTH_SECRET ?? '',
          (await cookies()).get(STAFF_REASON_COOKIE)?.value,
          tenant.id,
        )?.reason ?? null)
      : null;
  return {
    ...base,
    role: role === 'support' ? 'support' : 'admin',
    tenant,
    tenants,
    memberRole: null,
    memberSource: null,
    actor: tenant ? { kind: 'galaxie_staff' } : null,
    staffReason,
  };
});

/** Páginas do painel: sem acesso, volta para a home. */
export async function requireClientContext(): Promise<ClientContext> {
  const ctx = await readClientContext();
  if (!ctx) redirect('/');
  return ctx;
}
