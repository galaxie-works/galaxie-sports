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
import { SETTINGS_VIEWS, type PanelBlock } from '@/lib/ops/panel-tabs';
import { settingsHref } from '@/lib/ops/settings-items';

/** Job que aplica os ajustes da página, para o link "Job …" do topo (#1072) levar à Agenda. */
const VIEW_JOBS: Partial<Record<SettingsView, string>> = {
  live: 'live-run',
  mirror: 'sync-mirror',
  quality: 'data-quality',
  crests: 'assets-mirror',
};

interface PanelProps {
  view: SettingsView;
  extra?: () => Promise<ReactNode>;
  /** Chave do filtro do histórico (`?chave=`), lida da URL dentro do Suspense: o filtro vai na leitura do banco. */
  historyKey?: Promise<string | null>;
}

async function Panel({ view, extra, historyKey }: PanelProps) {
  // Sessão de admin (headers), fuso de quem vê (cookie) e a URL: fica fora do shell estático.
  await requireAdmin();
  const t = await getT();
  const timeZone = await getTimeZone();
  const key = (await historyKey) ?? null;
  try {
    const [snapshot, relatedChannels] = await Promise.all([
      readOpsSnapshot(new Date(), { historyKey: key }),
      extra?.(),
    ]);
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
export function OpsViewPanel({ view, extra, historyKey }: PanelProps) {
  return (
    <Suspense
      fallback={
        <LoadingStatus>
          <OpsPanelSkeleton />
        </LoadingStatus>
      }
    >
      <Panel view={view} extra={extra} historyKey={historyKey} />
    </Suspense>
  );
}

/**
 * Uma página de Ajustes feita do painel de Operação (Status dos serviços, Ao vivo, Pós-jogo, Agenda dos jobs, IA
 * interna…, #1069): os blocos dela, sob o caminho Ajustes / Grupo / Item. `extra` lê no servidor o que a página tem
 * além do painel (o controle dos canais dos Vídeos relacionados).
 */
export async function OpsViewPage({ view, extra, historyKey }: PanelProps) {
  const t = await getT();
  const blocks: readonly PanelBlock[] = SETTINGS_VIEWS[view];
  const job = VIEW_JOBS[view];
  return (
    <>
      <PageHeader title={t.ops.nav[view]} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsArea
          active={view}
          description={t.ops.views[view]}
          {...(job ? { job: { name: job, href: settingsHref('schedule') } } : {})}
          {...(view === 'history' ? {} : { historyHref: settingsHref('history') })}
          // cada bloco tem a âncora do próprio nome (OpsPanel); o índice só aparece com 2+ blocos
          sections={blocks.map((id) => ({ id, label: t.ops.tabs[id] }))}
        >
          <OpsViewPanel view={view} extra={extra} historyKey={historyKey} />
        </SettingsArea>
      </div>
    </>
  );
}
