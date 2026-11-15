import type { Metadata } from 'next';
import { Suspense } from 'react';

import { NarrationPanel } from '@/components/admin/narration-panel';
import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { FramePanelSkeleton, TableSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { listNarrationTemplates, narrationLog } from '@/lib/narration/templates';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.narrationAdmin.meta.title };
}

async function Content() {
  // Sessão de admin (headers) e fuso (cookie): fica fora do shell estático.
  await requireAdmin();
  const timeZone = await getTimeZone();
  const [templates, log] = await Promise.all([listNarrationTemplates(), narrationLog(30)]);
  return <NarrationPanel templates={templates} log={log} timeZone={timeZone} />;
}

/** Ajustes → Produtos → Lance a lance: as frases prontas da narração, editáveis por idioma (#1167). */
export default async function NarrationSettingsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.nav.narration} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="narration">
          <Suspense
            fallback={
              <LoadingStatus className="flex flex-col gap-4">
                <FramePanelSkeleton>
                  <TableSkeleton rows={10} />
                </FramePanelSkeleton>
              </LoadingStatus>
            }
          >
            <Content />
          </Suspense>
        </SettingsArea>
      </div>
    </>
  );
}
