'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useState } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: React.ReactNode }) {
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
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          {children}
          <Toaster theme="dark" />
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
