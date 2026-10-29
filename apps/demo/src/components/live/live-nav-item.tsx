'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { useHydrated } from '@/hooks/use-hydrated';
import { SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar';
import { fetchLiveEvents, LIVE_EVENTS_KEY } from '@/lib/galaxie/live';
import { useI18n } from '@/lib/i18n/client';
import { plural } from '@/lib/i18n/text';
import { topLevelClick } from '@/lib/trail';
import { cn } from '@/lib/utils';

export const LIVE_HREF = '/ao-vivo';

/** Ponto "ao vivo": pulsa quando há jogo em andamento. */
export function LiveDot({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      className={cn('relative flex size-2.5 shrink-0 items-center justify-center', className)}
      aria-hidden
    >
      {on ? (
        <span className="bg-live absolute inline-flex size-full animate-ping rounded-full opacity-60" />
      ) : null}
      <span
        className={cn('relative inline-flex size-2 rounded-full', on ? 'bg-live' : 'bg-muted-foreground/50')}
      />
    </span>
  );
}

/**
 * Subitem "Ao vivo" do menu Explorar: ponto pulsante e quantos jogos estão em andamento agora. Divide a
 * consulta com a página Ao vivo (mesma chave); fora dela, confere a cada 30 s.
 */
export function LiveNavItem({ active }: { active: boolean }) {
  const { locale, t } = useI18n();
  const hydrated = useHydrated();
  const query = useQuery({
    queryKey: LIVE_EVENTS_KEY,
    queryFn: () => fetchLiveEvents(locale),
    // na própria página Ao vivo quem agenda as atualizações é ela (o contador mostra esse ritmo)
    refetchInterval: active ? false : 30_000,
    staleTime: 10_000,
    retry: 1,
  });
  // o contador só aparece depois da hidratação (a resposta pode chegar antes da sidebar hidratar)
  const data = hydrated ? query.data : undefined;
  const count = data?.length ?? 0;
  const label = data ? plural(locale, count, t.live.nav.count) : t.live.nav.label;
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={active}
        aria-label={label}
        render={<Link href={LIVE_HREF} onClick={topLevelClick(LIVE_HREF)} />}
      >
        <LiveDot on={count > 0} className="mx-[3px]" />
        <span className="flex-1 truncate">{t.live.nav.label}</span>
        {data ? (
          <span
            aria-hidden
            className={cn(
              'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums',
              count > 0 && 'bg-live/15 text-live',
            )}
          >
            {count}
          </span>
        ) : null}
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
