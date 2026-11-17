import type { TenantState } from '@galaxie/db/schema';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { Badge } from '@/components/reui/badge';
import { requireClientContext, type ClientContext } from '@/lib/client/session';
import type { TenantInfo } from '@/lib/client/tenants';
import { getFormatters, getT } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

import { can, canSomewhere } from '@/lib/client/permissions';
import { isStaffRole } from '@/lib/auth/roles';

import {
  CLIENT_NAV,
  ClientNavSheet,
  ClientSideNav,
  navRequirement,
  sectionsForState,
  STATES_WITH_NOTICE_ONLY,
  type ClientSection,
} from './client-nav';
import { StaffReasonBanner } from './staff-reason-banner';
import { TenantStateNotice, type NoticeState } from './tenant-state-notice';
import { TenantSwitcher } from './tenant-switcher';

export type ClientAreaContext = ClientContext & { tenant: TenantInfo };

type BadgeVariant = 'success-light' | 'info-light' | 'warning-light' | 'destructive-light' | 'secondary';

/** Cor do crachá de estado (F3, decisão 8): ativo em verde, teste em azul, o que pede ação em amarelo, final em vermelho. */
const STATE_BADGE: Record<TenantState, BadgeVariant> = {
  draft: 'secondary',
  pending_review: 'secondary',
  rejected: 'destructive-light',
  trial: 'info-light',
  trial_expired: 'warning-light',
  active: 'success-light',
  past_due: 'warning-light',
  suspended: 'warning-light',
  cancelled: 'destructive-light',
};

/** Estados com faixa de aviso acima do conteúdo (o resto do console segue, restrito ou não). */
const STATES_WITH_BANNER: readonly TenantState[] = ['trial_expired', 'suspended', 'past_due'];

/**
 * Moldura das páginas do painel do cliente: menu lateral agrupado (gaveta no celular), tenant em foco (o admin escolhe; o cliente vê o dele)
 * e o conteúdo, que só renderiza com tenant. Lê a sessão: fica atrás de Suspense nas páginas.
 *
 * O estado do tenant (F3, decisão 8) manda no que aparece: `trial_expired` e `suspended` só abrem Planos e módulos e
 * Chaves, com a faixa de aviso; `past_due` abre tudo com a faixa; `trial` abre tudo e mostra o prazo no cabeçalho;
 * `pending_review`, `rejected`, `cancelled` (e `draft`) só mostram a tela do estado. A equipe Galaxie num tenant de
 * cliente vê a mesma restrição, com o aviso de que é o estado do cliente (a equipe age em Ajustes › Organizações).
 */
export async function ClientArea({
  section,
  children,
}: {
  section: ClientSection;
  children: (ctx: ClientAreaContext) => ReactNode | Promise<ReactNode>;
}) {
  const [ctx, t, fmt] = await Promise.all([requireClientContext(), getT(), getFormatters()]);
  const { tenant } = ctx;
  const byState = tenant ? sectionsForState(tenant.state) : null;
  // áreas que o estado da conta (F3), o cargo (#1019) e os módulos do tenant (#1018) abrem; o resto some do menu e a
  // página mostra o aviso
  const opens = (id: ClientSection) => {
    if (byState && !byState.includes(id)) return false;
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
  // só a tela do estado: nada da página renderiza
  const noticeOnly = tenant ? STATES_WITH_NOTICE_ONLY.includes(tenant.state) : false;
  const banner = tenant && STATES_WITH_BANNER.includes(tenant.state) ? (tenant.state as NoticeState) : null;
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
            {tenant?.state === 'trial' && tenant.trialEndsAt ? (
              <span className="text-muted-foreground text-xs">
                {fill(t.client.tenant.trialUntil, { date: fmt.date(tenant.trialEndsAt) })}
              </span>
            ) : null}
            {tenant ? (
              <Badge variant={STATE_BADGE[tenant.state]} radius="full">
                {t.client.tenant.states[tenant.state]}
              </Badge>
            ) : null}
          </div>
        </div>
        {staffOnClient ? <StaffReasonBanner tenant={tenant} reason={ctx.staffReason} /> : null}
        {tenant && banner ? (
          <TenantStateNotice
            state={banner}
            mode="banner"
            staff={staffOnClient}
            t={t.client.tenant.stateNotice}
          />
        ) : null}
        {tenant && noticeOnly ? (
          <TenantStateNotice
            state={tenant.state as NoticeState}
            mode="screen"
            staff={staffOnClient}
            t={t.client.tenant.stateNotice}
          />
        ) : tenant && denied ? (
          <EmptyState
            title={byState ? t.client.tenant.stateDenyTitle : t.client.tenant.denyTitle}
            description={byState ? t.client.tenant.stateDenyBody : t.client.tenant.denyBody}
          />
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
