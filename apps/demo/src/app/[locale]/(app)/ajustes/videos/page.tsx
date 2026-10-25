import { listRelatedChannels, RELATED_CHANNEL_BLOCK_THRESHOLD } from '@galaxie/db/related';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsNav } from '@/components/admin/settings-nav';
import { PageHeader } from '@/components/app-shell/page-header';
import { RelatedChannels, type ChannelFilter } from '@/components/admin/related-channels';
import { Skeleton } from '@/components/ui/skeleton';
import { requireAdmin } from '@/lib/auth/admin';
import { builderDb } from '@/lib/builder/store';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.relatedAdmin.meta.title };
}

type SearchParams = PageProps<'/[locale]/ajustes/videos'>['searchParams'];

const FILTERS: readonly ChannelFilter[] = ['all', 'blocked', 'refused'];

async function Content({ searchParams }: { searchParams: SearchParams }) {
  // Sessão de admin (headers) e filtros (URL): fica fora do shell estático.
  await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.slice(0, 80) : '';
  const filter = FILTERS.find((f) => f === params.filtro) ?? 'all';
  const timeZone = await getTimeZone();
  const channels = await listRelatedChannels(builderDb(), {
    q,
    ...(filter === 'all' ? {} : { only: filter }),
  });
  return (
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
  );
}

export default async function RelatedVideosAdminPage({
  searchParams,
}: PageProps<'/[locale]/ajustes/videos'>) {
  const t = await getT();
  return (
    <>
      <PageHeader title={t.relatedAdmin.page.title} kind="ajustes" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <SettingsNav active="related" />
        <p className="text-muted-foreground max-w-3xl text-sm">
          {fill(t.relatedAdmin.page.description, { threshold: RELATED_CHANNEL_BLOCK_THRESHOLD })}
        </p>
        <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
          <Content searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
