'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useState } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider, TimeZoneSync } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import type { ClientDictionary } from '@/lib/i18n/dictionary';

export function Providers({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: ClientDictionary;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // A API já serve last-known-good com cache; o cliente só evita refetch desnecessário.
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );

  // A demo é só tema escuro (classe `dark` fixa no <html>): sem next-themes, que injeta um <script>
  // que o React 19 rejeita; o Toaster recebe o tema direto.
  return (
    <I18nProvider locale={locale} messages={messages}>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            {children}
            <TimeZoneSync />
            <Toaster theme="dark" />
          </TooltipProvider>
        </MotionConfig>
      </QueryClientProvider>
    </I18nProvider>
  );
}
