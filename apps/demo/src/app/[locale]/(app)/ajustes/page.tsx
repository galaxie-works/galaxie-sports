import type { Metadata } from 'next';

import { SettingsHome } from '@/components/admin/settings-home';
import { SettingsArea } from '@/components/admin/settings-nav';
import { PageHeader } from '@/components/app-shell/page-header';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.title };
}

/** Ajustes → Início (fixo no topo do menu, #1068): o que espera ação e o mapa dos grupos. */
export default async function SettingsHomePage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.nav.home} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="home">
          <SettingsHome />
        </SettingsArea>
      </div>
    </>
  );
}
