import type { Metadata } from 'next';

import { SettingsGroupsMap } from '@/components/admin/settings-home';
import { SettingsArea } from '@/components/admin/settings-nav';
import { PageHeader } from '@/components/app-shell/page-header';
import { SettingsHome } from '@/components/settings/home';
import { getT } from '@/lib/i18n/server';
import { settingsHref } from '@/lib/ops/settings-items';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.title };
}

/**
 * Ajustes → Início (fixo no topo do menu, A2, #1073): os sete cartões do que pede ação, as últimas mudanças do painel
 * (carregam atrás de um esqueleto, sem segurar a página) e, embaixo, o mapa dos grupos do menu.
 */
export default async function SettingsHomePage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.nav.home} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea
          active="home"
          description={t.ops.home.description}
          historyHref={settingsHref('history')}
        >
          <SettingsHome />
          <SettingsGroupsMap />
        </SettingsArea>
      </div>
    </>
  );
}
