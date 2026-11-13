import { listTenantWebhooks, MAX_WEBHOOKS_PER_TENANT, PLANS_WITHOUT_REALTIME } from '@galaxie/db/webhooks';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { WebhooksPanel } from '@/components/client/webhooks-panel';
import { builderDb } from '@/lib/builder/store';
import { webhookSecrets, webhookTopicChoices } from '@/lib/client/webhooks';
import { getLocale, getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.webhooks.meta.title };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function Webhooks() {
  const [timeZone, locale] = await Promise.all([getTimeZone(), getLocale()]);
  return (
    <ClientArea section="webhooks">
      {async ({ tenant }) => {
        // O tenant vem da sessão (ClientArea): o cliente só vê e muda os webhooks dele.
        const rows = await listTenantWebhooks(builderDb(), tenant.id);
        // só os tópicos emitidos dos módulos ligados no tenant (registro de tópicos, #1023)
        const { options, labels } = webhookTopicChoices(tenant.modules, locale);
        return (
          <WebhooksPanel
            webhooks={rows.map((w) => ({
              id: w.id,
              url: w.url,
              description: w.description,
              topics: w.topics,
              filters: w.filters,
              active: w.active,
              autoDisabledAt: iso(w.autoDisabledAt),
              autoDisabledReason: w.autoDisabledReason,
              createdAt: w.createdAt.toISOString(),
              pending: w.pending,
              dead: w.dead,
              delivered24h: w.delivered24h,
              lastDeliveredAt: iso(w.lastDeliveredAt),
              lastFailureAt: iso(w.lastFailureAt),
              lastError: w.lastError,
            }))}
            topicOptions={options}
            topicLabels={labels}
            planAllows={!(PLANS_WITHOUT_REALTIME as readonly string[]).includes(tenant.plan)}
            available={webhookSecrets() !== null}
            max={MAX_WEBHOOKS_PER_TENANT}
            timeZone={timeZone}
          />
        );
      }}
    </ClientArea>
  );
}

export default async function ClientWebhooksPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.webhooks.title}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense
          fallback={
            <LoadingStatus>
              <TablePanelSkeleton action rows={3} columns={['flex-1', 'w-32', 'w-24', 'w-16']} />
            </LoadingStatus>
          }
        >
          <Webhooks />
        </Suspense>
      </div>
    </>
  );
}
