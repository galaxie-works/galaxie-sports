import { Suspense } from 'react';

import { ActivityTracker } from '@/components/app-shell/activity-tracker';
import { AppSidebar } from '@/components/app-shell/app-sidebar';
import { RelatedPlayerProvider } from '@/components/sport/related-player';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default function AppLayout({ children }: LayoutProps<'/[locale]'>) {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* Player de conteúdo relacionado: painel acoplado à direita, irmão do conteúdo (não é modal). */}
      <RelatedPlayerProvider>
        <SidebarInset>{children}</SidebarInset>
      </RelatedPlayerProvider>
      {/* Caminho atual = dado de URL: fora do shell estático. */}
      <Suspense>
        <ActivityTracker />
      </Suspense>
    </SidebarProvider>
  );
}
