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

import { getTenantInfo, listTenantOptions, type TenantInfo, type TenantOption } from './tenants';

/** Tenant que o admin está acompanhando no painel do cliente. */
export const TENANT_COOKIE = 'galaxie-tenant';

export interface ClientContext {
  userId: string;
  email: string;
  role: 'admin' | 'client';
  /** Tenant em foco; null = cliente sem tenant (convite incompleto) ou nenhum tenant no banco. */
  tenant: TenantInfo | null;
  /** Só para o admin: os tenants que ele pode escolher. */
  tenants: TenantOption[];
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

  if (role === 'client') {
    const tenantId = (session.user as { tenantId?: string | null }).tenantId ?? null;
    const tenant = tenantId ? await getTenantInfo(tenantId) : null;
    return { ...base, role: 'client', tenant, tenants: [] };
  }

  const tenants = await listTenantOptions();
  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  const id = tenants.find((t) => t.id === chosen)?.id ?? tenants[0]?.id ?? null;
  return { ...base, role: 'admin', tenant: id ? await getTenantInfo(id) : null, tenants };
});

/** Páginas do painel: sem acesso, volta para a home. */
export async function requireClientContext(): Promise<ClientContext> {
  const ctx = await readClientContext();
  if (!ctx) redirect('/');
  return ctx;
}
