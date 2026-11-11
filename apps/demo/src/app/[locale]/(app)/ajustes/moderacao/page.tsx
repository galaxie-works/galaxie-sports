import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ModerationListsPanel } from '@/components/admin/moderation-lists-panel';
import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { FormSkeleton, FramePanelSkeleton, TableSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { baseListLog, listBaseLists } from '@/lib/engage/moderation-lists';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.moderationLists.meta.title };
}

async function Content() {
  // Sessão de admin (headers) e fuso (cookie): fica fora do shell estático.
  await requireAdmin();
  const timeZone = await getTimeZone();
  const [lists, log] = await Promise.all([listBaseLists(), baseListLog(30)]);
  return (
    <ModerationListsPanel
      timeZone={timeZone}
      lists={lists.map(({ list, locale, terms, version, updatedAt }) => ({
        list,
        locale,
        terms,
        version,
        updatedAt,
      }))}
      log={log}
    />
  );
}

export default async function ModerationSettingsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.nav.moderation} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="moderation">
          <Suspense
            fallback={
              <LoadingStatus className="flex flex-col gap-4">
                <FramePanelSkeleton>
                  <TableSkeleton rows={8} />
                </FramePanelSkeleton>
                <FramePanelSkeleton>
                  <FormSkeleton fields={3} />
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
