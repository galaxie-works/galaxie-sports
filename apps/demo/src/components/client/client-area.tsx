import type { ReactNode } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { Badge } from '@/components/reui/badge';
import { requireClientContext, type ClientContext } from '@/lib/client/session';
import type { TenantInfo } from '@/lib/client/tenants';
import { getT } from '@/lib/i18n/server';

import { can, canSomewhere } from '@/lib/client/permissions';
import { isStaffRole } from '@/lib/auth/roles';

import { CLIENT_NAV, ClientNavSheet, ClientSideNav, navRequirement, type ClientSection } from './client-nav';
import { StaffReasonBanner } from './staff-reason-banner';
import { TenantSwitcher } from './tenant-switcher';

export type ClientAreaContext = ClientContext & { tenant: TenantInfo };

/**
 * Moldura das páginas do painel do cliente: menu lateral agrupado (gaveta no celular), tenant em foco (o admin escolhe; o cliente vê o dele)
 * e o conteúdo, que só renderiza com tenant. Lê a sessão: fica atrás de Suspense nas páginas.
 */
export async function ClientArea({
  section,
  children,
}: {
  section: ClientSection;
  children: (ctx: ClientAreaContext) => ReactNode | Promise<ReactNode>;
}) {
  const [ctx, t] = await Promise.all([requireClientContext(), getT()]);
  const { tenant } = ctx;
  // áreas que o cargo (#1019) e os módulos do tenant (#1018) abrem; o resto some do menu e a página mostra o aviso
  const opens = (id: ClientSection) => {
    const req = navRequirement(id);
    if (req.action && !(req.scoped ? canSomewhere(ctx, req.action) : can(ctx, req.action))) return false;
    if (req.module && !tenant?.modules.includes(req.module)) return false;
    return true;
  };
  const visible = tenant ? CLIENT_NAV.map((i) => i.id).filter(opens) : undefined;
  const denied = tenant ? !opens(section) : false;
  const staff = isStaffRole(ctx.role);
  // a equipe num tenant de cliente escreve só com motivo (PL17): a moldura mostra o motivo em vigor ou cobra um
  const staffOnClient = staff && tenant !== null && !tenant.isGalaxie;
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <ClientSideNav active={section} visible={visible} className="hidden lg:sticky lg:top-18 lg:block" />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ClientNavSheet active={section} visible={visible} className="lg:hidden" />
          <div className="ml-auto flex items-center gap-2">
            {(staff && ctx.tenants.length) || ctx.tenants.length > 1 ? (
              <TenantSwitcher tenants={ctx.tenants} value={tenant?.id ?? null} askReason={staff} />
            ) : tenant ? (
              <span className="text-sm font-medium">{tenant.name}</span>
            ) : null}
            {tenant ? (
              <Badge variant={tenant.status === 'active' ? 'success-light' : 'warning-light'} radius="full">
                {t.client.tenant.status[tenant.status]}
              </Badge>
            ) : null}
          </div>
        </div>
        {staffOnClient ? <StaffReasonBanner tenant={tenant} reason={ctx.staffReason} /> : null}
        {tenant && denied ? (
          <EmptyState title={t.client.tenant.denyTitle} description={t.client.tenant.denyBody} />
        ) : tenant ? (
          await children({ ...ctx, tenant })
        ) : (
          <EmptyState
            title={t.client.title}
            description={staff ? t.client.tenant.none : t.client.tenant.noneClient}
          />
        )}
      </div>
    </div>
  );
}
