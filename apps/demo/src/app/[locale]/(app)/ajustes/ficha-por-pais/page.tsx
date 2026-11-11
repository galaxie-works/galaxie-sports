import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CountryPoliciesPanel } from '@/components/admin/country-policies-panel';
import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { FormSkeleton, FramePanelSkeleton, TableSkeleton } from '@/components/app-shell/skeletons';
import { requireAdmin } from '@/lib/auth/admin';
import { listTenantOptions } from '@/lib/client/tenants';
import { allTenantCountries, listPolicies, policyLog } from '@/lib/engage/country-policies';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.countryPolicies.meta.title };
}

async function Content() {
  // Sessão de admin (headers) e fuso (cookie): fica fora do shell estático.
  await requireAdmin();
  const timeZone = await getTimeZone();
  const [policies, log, tenants, countries] = await Promise.all([
    listPolicies(),
    policyLog(30),
    listTenantOptions(),
    allTenantCountries(),
  ]);
  return (
    <CountryPoliciesPanel
      timeZone={timeZone}
      policies={policies.map(({ country, policy, version, updatedAt }) => ({
        country,
        policy,
        version,
        updatedAt,
      }))}
      log={log}
      tenants={tenants.map((x) => ({ id: x.id, name: x.name, countries: countries.get(x.id) ?? [] }))}
    />
  );
}

export default async function CountryProfileSettingsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.nav.countryProfile} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active="countryProfile">
          <Suspense
            fallback={
              <LoadingStatus className="flex flex-col gap-4">
                <FramePanelSkeleton>
                  <TableSkeleton rows={6} />
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
