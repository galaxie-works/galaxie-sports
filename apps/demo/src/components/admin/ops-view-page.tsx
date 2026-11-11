import type { ReactNode } from 'react';
import { Suspense } from 'react';

import { SettingsArea } from '@/components/admin/settings-nav';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { OpsPanelSkeleton } from '@/components/app-shell/skeletons';
import { OpsPanel, type SettingsView } from '@/components/ops/ops-panel';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { requireAdmin } from '@/lib/auth/admin';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { OpsUnavailableError, readOpsSnapshot } from '@/lib/ops/data';

async function Panel({ view, extra }: { view: SettingsView; extra?: () => Promise<ReactNode> }) {
  // Sessão de admin (headers) e fuso de quem vê (cookie): fica fora do shell estático.
  await requireAdmin();
  const t = await getT();
  const timeZone = await getTimeZone();
  try {
    const [snapshot, relatedChannels] = await Promise.all([readOpsSnapshot(), extra?.()]);
    return <OpsPanel snapshot={snapshot} timeZone={timeZone} view={view} relatedChannels={relatedChannels} />;
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
 * Os blocos do painel de Operação de um item de Ajustes, com o carregamento e o aviso de banco fora do ar. Serve às
 * páginas feitas só do painel (`OpsViewPage`) e às que têm um bloco dele junto (Escudos e logos, Grades e ofertas).
 */
export function OpsViewPanel({ view, extra }: { view: SettingsView; extra?: () => Promise<ReactNode> }) {
  return (
    <Suspense
      fallback={
        <LoadingStatus>
          <OpsPanelSkeleton />
        </LoadingStatus>
      }
    >
      <Panel view={view} extra={extra} />
    </Suspense>
  );
}

/**
 * Uma página de Ajustes feita do painel de Operação (Status dos serviços, Ao vivo, Pós-jogo, Agenda dos jobs, IA
 * interna…, #1069): os blocos dela, sob o caminho Ajustes / Grupo / Item. `extra` lê no servidor o que a página tem
 * além do painel (o controle dos canais dos Vídeos relacionados).
 */
export async function OpsViewPage({ view, extra }: { view: SettingsView; extra?: () => Promise<ReactNode> }) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.nav[view]} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea active={view}>
          <OpsViewPanel view={view} extra={extra} />
        </SettingsArea>
      </div>
    </>
  );
}
