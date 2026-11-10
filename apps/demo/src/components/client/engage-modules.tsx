import type { EngageModule } from '@galaxie/db/engage-modules';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { UsageMeter } from '@/components/settings';
import type { EngageModuleInfo } from '@/lib/client/tenants';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';

/** O que cada módulo mede no mês (o pico do chat aparece no medidor da faixa). */
const METRICS: Record<EngageModule, readonly ('active_fans' | 'clicks' | 'credits')[]> = {
  live_chat: ['active_fans'],
  communities: ['active_fans'],
  gamification: ['active_fans'],
  shopping: ['clicks'],
  cosmos_ai: ['credits'],
};

/**
 * Módulos de engajamento do tenant (#1018): faixa contratada e uso do mês, para o cliente e para a Galaxie (que vê
 * o mesmo painel escolhendo o tenant). Sem preço: o cliente vê faixa e uso. Some quando nenhum está contratado.
 */
export function EngageModules({
  modules,
  locale,
  t,
}: {
  modules: EngageModuleInfo[];
  locale: Locale;
  t: Dictionary;
}) {
  if (!modules.length) return null;
  const o = t.client.overview;
  const e = o.engage;
  const num = new Intl.NumberFormat(locale);
  return (
    <Frame className="lg:col-span-3">
      <FramePanel className="flex flex-col gap-4">
        <FrameHeader className="p-0">
          <FrameTitle>{e.title}</FrameTitle>
          <FrameDescription>{e.description}</FrameDescription>
        </FrameHeader>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const peak = m.limits.find((l) => l.key === 'live_chat.peak_connections');
            const others = m.limits.filter((l) => l !== peak);
            return (
              <div key={m.module} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{o.moduleNames[m.module]}</span>
                  <Badge variant="success-light" size="sm">
                    {e.on}
                  </Badge>
                </div>
                {peak ? (
                  <UsageMeter
                    label={e.limits[peak.key]}
                    used={m.usage.peak_connections ?? 0}
                    total={peak.value}
                  />
                ) : null}
                {others.map((l) => (
                  <div key={l.key} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{e.limits[l.key]}</span>
                    <span className="text-muted-foreground tabular-nums">{num.format(l.value)}</span>
                  </div>
                ))}
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {METRICS[m.module].map((metric) => (
                    <div key={metric} className="flex flex-col gap-0.5">
                      <dt className="text-muted-foreground text-xs">{e.metrics[metric]}</dt>
                      <dd className="font-semibold tabular-nums">{num.format(m.usage[metric] ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      </FramePanel>
    </Frame>
  );
}
