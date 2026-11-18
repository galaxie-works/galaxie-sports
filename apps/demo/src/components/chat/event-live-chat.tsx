'use client';

import { DEFAULT_THEMES, GalaxieWidgetProvider, LiveChat } from '@galaxie/widgets';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { getDemoFanToken, OPEN_FAN_PROFILE_EVENT } from '@/lib/fan/client';
import { useI18n } from '@/lib/i18n/client';

/**
 * Chat ao vivo na página do jogo da demo (#977): o widget `live_chat` pelo proxy da demo, com o token do torcedor
 * da pessoa logada (perfil de torcedor no menu do usuário). A faixa do perfil decide: `18plus` escreve, `13_17` lê e
 * reage. O demo é um tenant como outro qualquer: a sala é a dele, sem sala geral misturando clientes.
 */
export function EventLiveChat({ eventId, market }: { eventId: string; market?: string | undefined }) {
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  // o tema só existe no navegador: antes de montar, o claro (o chat nem aparece no HTML do servidor)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const theme = mounted && resolvedTheme === 'dark' ? DEFAULT_THEMES.dark : DEFAULT_THEMES.light;
  return (
    <GalaxieWidgetProvider
      baseUrl="/api/galaxie"
      publishableKey=""
      theme={theme}
      locale={locale === 'es-AR' ? 'es' : locale}
      market={market}
      getFanToken={() => getDemoFanToken()}
      onFanSignIn={() => window.dispatchEvent(new Event(OPEN_FAN_PROFILE_EVENT))}
    >
      <LiveChat eventId={eventId} height={360} />
    </GalaxieWidgetProvider>
  );
}
