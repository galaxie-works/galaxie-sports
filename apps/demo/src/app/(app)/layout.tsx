import { Suspense } from 'react';

import { ActivityTracker } from '@/components/app-shell/activity-tracker';
import { AppSidebar } from '@/components/app-shell/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
      {/* Caminho atual = dado de URL: fora do shell estático. */}
      <Suspense>
        <ActivityTracker />
      </Suspense>
    </SidebarProvider>
  );
}
