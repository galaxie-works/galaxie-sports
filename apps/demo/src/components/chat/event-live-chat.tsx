'use client';

import { DEFAULT_THEMES, FAN_TOKEN_CHANGED_EVENT, GalaxieWidgetProvider, LiveChat } from '@galaxie/widgets';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { FanProfileDialog } from '@/components/app-shell/fan-profile-dialog';
import { authClient } from '@/lib/auth/client';
import { getDemoFanToken } from '@/lib/fan/client';
import type { FanProfile } from '@/lib/fan/profile';
import { useI18n } from '@/lib/i18n/client';

/**
 * Chat ao vivo na página do jogo da demo (#977): o widget `live_chat` pelo proxy da demo, com o token do torcedor
 * da pessoa logada. A faixa do perfil de torcedor decide: `18plus` escreve, `13_17` lê e reage. O "Entrar" do widget
 * abre o perfil de torcedor aqui mesmo (no celular o menu do usuário fica fechado dentro da barra lateral). O demo é
 * um tenant como outro qualquer: a sala é a dele, sem sala geral misturando clientes.
 */
export function EventLiveChat({ eventId, market }: { eventId: string; market?: string | undefined }) {
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const { data, refetch } = authClient.useSession();
  const [profileOpen, setProfileOpen] = useState(false);
  // só no navegador: o tema certo desde o primeiro quadro, e nada do chat no HTML do servidor
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const theme = resolvedTheme === 'dark' ? DEFAULT_THEMES.dark : DEFAULT_THEMES.light;
  const user = data?.user as
    { fanNickname?: string | null; fanAgeBand?: string | null; fanCountry?: string | null } | undefined;
  return (
    <>
      <GalaxieWidgetProvider
        baseUrl="/api/galaxie"
        publishableKey=""
        theme={theme}
        locale={locale === 'es-AR' ? 'es' : locale}
        market={market}
        getFanToken={() => getDemoFanToken()}
        onFanSignIn={() => setProfileOpen(true)}
      >
        <LiveChat eventId={eventId} height={360} />
      </GalaxieWidgetProvider>
      {profileOpen ? (
        <FanProfileDialog
          open
          onOpenChange={(open) => {
            setProfileOpen(open);
            if (!open) {
              refetch();
              // os widgets pedem o token de novo (perfil novo, faixa nova)
              document.dispatchEvent(new Event(FAN_TOKEN_CHANGED_EVENT));
            }
          }}
          initial={{
            nickname: user?.fanNickname ?? undefined,
            ageBand: (user?.fanAgeBand as FanProfile['ageBand'] | null) ?? undefined,
            country: (user?.fanCountry as FanProfile['country'] | null) ?? undefined,
          }}
        />
      ) : null}
    </>
  );
}
