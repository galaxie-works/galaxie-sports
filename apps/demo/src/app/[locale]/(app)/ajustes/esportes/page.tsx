import { listRelatedChannels, RELATED_CHANNEL_BLOCK_THRESHOLD } from '@galaxie/db/related';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RelatedChannels, type ChannelFilter } from '@/components/admin/related-channels';
import { SettingsNav } from '@/components/admin/settings-nav';
import { PageHeader } from '@/components/app-shell/page-header';
import { OpsPanel } from '@/components/ops/ops-panel';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { requireAdmin } from '@/lib/auth/admin';
import { builderDb } from '@/lib/builder/store';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { OpsUnavailableError, readOpsSnapshot } from '@/lib/ops/data';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.features.title };
}

type SearchParams = PageProps<'/[locale]/ajustes/esportes'>['searchParams'];

const FILTERS: readonly ChannelFilter[] = ['all', 'blocked', 'refused'];

async function Panel({ searchParams }: { searchParams: SearchParams }) {
  // Sessão de admin (headers), filtros (URL) e fuso de quem vê (cookie): fica fora do shell estático.
  await requireAdmin();
  const t = await getT();
  const timeZone = await getTimeZone();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.slice(0, 80) : '';
  const filter = FILTERS.find((f) => f === params.filtro) ?? 'all';
  const tab = typeof params.aba === 'string' ? params.aba : undefined;
  try {
    const [snapshot, channels] = await Promise.all([
      readOpsSnapshot(),
      listRelatedChannels(builderDb(), { q, ...(filter === 'all' ? {} : { only: filter }) }),
    ]);
    return (
      <OpsPanel
        snapshot={snapshot}
        timeZone={timeZone}
        scope="features"
        initialTab={tab}
        relatedChannels={
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground max-w-3xl text-sm">
              {fill(t.relatedAdmin.page.description, { threshold: RELATED_CHANNEL_BLOCK_THRESHOLD })}
            </p>
            <RelatedChannels
              channels={channels.map((c) => ({
                ...c,
                lastRefusedAt: c.lastRefusedAt?.toISOString() ?? null,
                ruleAt: c.ruleAt?.toISOString() ?? null,
              }))}
              q={q}
              filter={filter}
              timeZone={timeZone}
            />
          </div>
        }
      />
    );
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

export default async function SportsFeaturesPage({ searchParams }: PageProps<'/[locale]/ajustes/esportes'>) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.ops.features.title} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsNav active="features" />
        <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
          <Panel searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
