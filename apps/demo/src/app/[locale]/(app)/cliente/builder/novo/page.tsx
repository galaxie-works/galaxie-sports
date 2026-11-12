import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { EditorSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { WidgetEditor } from '@/components/client/widget-editor';
import { ENTITY_TYPES, marketsFor, parseWidgetInput } from '@/lib/builder/config';
import { brandThemeItems, draftOf, guideChannelChoices, newDraft } from '@/lib/builder/editor';
import { decodeDraftParam } from '@/lib/cosmos/widget-compose';
import { getI18n, getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.newWidget };
}

async function NewWidget({
  searchParams,
}: {
  searchParams: PageProps<'/[locale]/cliente/builder/novo'>['searchParams'];
}) {
  const [{ tipo, tema, esporte, cosmos }, { locale }] = await Promise.all([searchParams, getI18n()]);
  return (
    <ClientArea section="builder">
      {async ({ tenant }) => {
        const brandThemes = await brandThemeItems(tenant.id);
        // widget montado pela Cosmos (#1005): a URL traz o rascunho, que passa de novo pela validação de salvar
        const fromCosmos = parseWidgetInput(decodeDraftParam(cosmos), {
          markets: tenant.markets,
          entityTypes: (kind) => ENTITY_TYPES[kind],
          sports: tenant.sports,
        });
        return (
          <WidgetEditor
            initial={
              fromCosmos.ok
                ? await draftOf(fromCosmos.value, locale)
                : newDraft(
                    typeof tipo === 'string' ? tipo : undefined,
                    tenant,
                    locale,
                    brandThemes,
                    typeof tema === 'string' ? tema : undefined,
                    typeof esporte === 'string' ? esporte : undefined,
                  )
            }
            saved={null}
            markets={marketsFor(tenant.markets)}
            sports={tenant.sports}
            guideChannels={await guideChannelChoices(tenant.id)}
            brandThemes={brandThemes}
          />
        );
      }}
    </ClientArea>
  );
}

export default async function NewWidgetPage({ searchParams }: PageProps<'/[locale]/cliente/builder/novo'>) {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.editor.newTitle}
        kind="cliente"
        parents={[
          { path: '/cliente', label: t.client.title, kind: 'cliente' },
          { path: '/cliente/builder', label: t.client.builder.title, kind: 'cliente' },
        ]}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
        <Suspense
          fallback={
            <LoadingStatus>
              <EditorSkeleton />
            </LoadingStatus>
          }
        >
          <NewWidget searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
