import type { StoreItem, StoreState } from '@galaxie/billing';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { getTenantPlanStore } from '@/lib/client/entitlements';
import type { TenantInfo } from '@/lib/client/tenants';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';

type BadgeVariant =
  'success-light' | 'info-light' | 'primary-light' | 'warning-light' | 'outline' | 'secondary';

/** Cor do estado: o que o tenant tem em verde, o que dá para contratar em azul, o resto neutro. */
const STATE_VARIANT: Record<StoreState, BadgeVariant> = {
  included: 'success-light',
  trial: 'info-light',
  available: 'primary-light',
  needs_plan: 'warning-light',
  contract: 'outline',
  soon: 'secondary',
  closed: 'outline',
  blocked: 'outline',
};

/** Loja de features do tenant: cada módulo do catálogo com o estado para este tenant (#1137). */
export async function PlansPanel({ tenant, t }: { tenant: TenantInfo; t: Dictionary }) {
  const p = t.client.planStore;
  const o = t.client.overview;
  const store = await getTenantPlanStore(tenant.id).catch((err: unknown) => {
    // catálogo ausente ou inválido, banco fora: aparece no log, não só na tela
    console.error('Planos e módulos: não foi possível ler os direitos do tenant', err);
    return null;
  });
  if (!store) return <p className="text-muted-foreground text-sm">{p.unavailable}</p>;

  const planName = (plan: string) => o.plans[plan as keyof typeof o.plans] ?? plan;
  const moduleName = (item: StoreItem) =>
    o.moduleNames[item.module as keyof typeof o.moduleNames] ?? item.name;
  const groups = [
    { id: 'data', title: p.data, items: store.items.filter((i) => i.kind === 'data') },
    { id: 'engage', title: p.engage, items: store.items.filter((i) => i.kind === 'engage') },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="flex flex-col gap-2">
          <FrameHeader className="p-0">
            <FrameTitle>{p.title}</FrameTitle>
            <FrameDescription>{p.description}</FrameDescription>
          </FrameHeader>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{p.current}</span>
            <Badge variant="secondary">{planName(store.entitlements.plan)}</Badge>
          </div>
          {store.items.some((i) => i.state === 'blocked') ? (
            <p role="status" className="text-warning-foreground text-sm">
              {p.blockedNotice}
            </p>
          ) : null}
        </FramePanel>
      </Frame>
      {groups.map((g) => (
        <Frame key={g.id}>
          <FramePanel className="flex flex-col gap-3">
            <FrameHeader className="p-0">
              <FrameTitle>
                <h2 id={`planos-${g.id}`}>{g.title}</h2>
              </FrameTitle>
            </FrameHeader>
            <ul aria-labelledby={`planos-${g.id}`} className="divide-border flex flex-col divide-y">
              {g.items.map((item) => (
                <li key={item.module} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{moduleName(item)}</span>
                    {item.state === 'needs_plan' && item.plans?.length ? (
                      <span className="text-muted-foreground text-xs">
                        {fill(p.needsPlan, { plans: planName(item.plans[0]!) })}
                      </span>
                    ) : null}
                    {item.state === 'available' && item.trialDays ? (
                      <span className="text-muted-foreground text-xs">
                        {fill(p.trialDays, { days: item.trialDays })}
                      </span>
                    ) : null}
                  </div>
                  <Badge variant={STATE_VARIANT[item.state]}>{p.states[item.state]}</Badge>
                </li>
              ))}
            </ul>
          </FramePanel>
        </Frame>
      ))}
    </div>
  );
}
