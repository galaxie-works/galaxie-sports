import type { ReactNode } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { Badge } from '@/components/reui/badge';
import { requireClientContext, type ClientContext } from '@/lib/client/session';
import type { TenantInfo } from '@/lib/client/tenants';
import { getT } from '@/lib/i18n/server';

import { ClientNav, type ClientSection } from './client-nav';
import { TenantSwitcher } from './tenant-switcher';

export type ClientAreaContext = ClientContext & { tenant: TenantInfo };

/**
 * Moldura das páginas do painel do cliente: abas, tenant em foco (o admin escolhe; o cliente vê o dele)
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
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ClientNav active={section} />
        <div className="flex items-center gap-2">
          {ctx.role === 'admin' && ctx.tenants.length ? (
            <TenantSwitcher tenants={ctx.tenants} value={tenant?.id ?? null} />
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
      {tenant ? (
        await children({ ...ctx, tenant })
      ) : (
        <EmptyState
          title={t.client.title}
          description={ctx.role === 'admin' ? t.client.tenant.none : t.client.tenant.noneClient}
        />
      )}
    </>
  );
}
