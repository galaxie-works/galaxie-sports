import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { SettingsArea, type SettingsSectionId } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { OpsPanelSkeleton } from '@/components/app-shell/skeletons';
import { OpsPanel, type SystemView } from '@/components/ops/ops-panel';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { requireAdmin } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { OpsUnavailableError, readOpsSnapshot } from '@/lib/ops/data';
import { systemTabRoute } from '@/lib/ops/system-routes';

async function Panel({
  view,
  redirectFrom,
}: {
  view: SystemView;
  redirectFrom?: Promise<{ aba?: string | string[] }>;
}) {
  // link antigo do Sistema (`?aba=`): vai para a área nova da aba. Dado de URL: atrás do Suspense, como a sessão
  if (redirectFrom) {
    const aba = (await redirectFrom).aba;
    const target = systemTabRoute(typeof aba === 'string' ? aba : undefined);
    if (target && target !== '/ajustes/sistema') redirect(target);
  }
  // Sessão de admin (headers) e fuso de quem vê (cookie): fica fora do shell estático.
  await requireAdmin();
  const t = await getT();
  const timeZone = await getTimeZone();
  try {
    const snapshot = await readOpsSnapshot();
    return <OpsPanel snapshot={snapshot} timeZone={timeZone} scope="system" view={view} />;
  } catch (err) {
    if (!(err instanceof OpsUnavailableError)) throw err;
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{t.ops.unavailable.title}</EmptyTitle>
          <EmptyDescription>{t.ops.unavailable.description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
}

/**
 * Uma área da Plataforma em Ajustes (Operação, Fornecedor, IA interna, Sistema): o painel de Operação com as seções
 * dela empilhadas, dentro do menu lateral de Ajustes (#1001).
 */
export async function OpsViewPage({
  view,
  active,
  redirectFrom,
}: {
  view: SystemView;
  active: SettingsSectionId;
  /** Só no Sistema: os parâmetros da URL, para levar `?aba=` antigo à área nova. */
  redirectFrom?: Promise<{ aba?: string | string[] }>;
}) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.nav[active]} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active={active}>
          <Suspense
            fallback={
              <LoadingStatus>
                <OpsPanelSkeleton />
              </LoadingStatus>
            }
          >
            <Panel view={view} redirectFrom={redirectFrom} />
          </Suspense>
        </SettingsArea>
      </div>
    </>
  );
}
