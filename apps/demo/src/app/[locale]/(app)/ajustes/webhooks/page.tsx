import { webhookAdminOverview } from '@galaxie/db/webhooks';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FormSkeleton, FramePanelSkeleton, TableSkeleton } from '@/components/app-shell/skeletons';
import { SettingsNav } from '@/components/admin/settings-nav';
import { WebhooksControl } from '@/components/admin/webhooks-control';
import { PageHeader } from '@/components/app-shell/page-header';
import { requireAdmin } from '@/lib/auth/admin';
import { builderDb } from '@/lib/builder/store';
import { webhookSecrets } from '@/lib/client/webhooks';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.webhooksAdmin.meta.title };
}

async function Content() {
  // Sessão de admin (headers) e fuso (cookie): fica fora do shell estático.
  await requireAdmin();
  const timeZone = await getTimeZone();
  const o = await webhookAdminOverview(builderDb());
  return (
    <WebhooksControl
      timeZone={timeZone}
      panelKek={webhookSecrets() !== null}
      overview={{
        ...o,
        worker: { ...o.worker, reportedAt: o.worker.reportedAt?.toISOString() ?? null },
      }}
    />
  );
}

export default async function WebhooksSettingsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.page.title} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsNav active="webhooks" />
        <Suspense
          fallback={
            <div className="grid gap-4 lg:grid-cols-2">
              <FramePanelSkeleton>
                <FormSkeleton fields={2} />
              </FramePanelSkeleton>
              <FramePanelSkeleton>
                <TableSkeleton rows={4} />
              </FramePanelSkeleton>
            </div>
          }
        >
          <Content />
        </Suspense>
      </div>
    </>
  );
}
