import { listRelatedChannels, RELATED_CHANNEL_BLOCK_THRESHOLD } from '@galaxie/db/related';
import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { RelatedChannels, type ChannelFilter } from '@/components/admin/related-channels';
import { builderDb } from '@/lib/builder/store';
import { getT, getTimeZone } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.related };
}

type SearchParams = PageProps<'/[locale]/ajustes/videos'>['searchParams'];

const FILTERS: readonly ChannelFilter[] = ['all', 'blocked', 'refused'];

/** Controle dos canais, com a busca e o filtro da URL (lido atrás do Suspense do painel, depois da sessão). */
async function Channels({ searchParams }: { searchParams: SearchParams }) {
  const [t, timeZone, params] = await Promise.all([getT(), getTimeZone(), searchParams]);
  const q = typeof params.q === 'string' ? params.q.slice(0, 80) : '';
  const filter = FILTERS.find((f) => f === params.filtro) ?? 'all';
  const channels = await listRelatedChannels(builderDb(), {
    q,
    ...(filter === 'all' ? {} : { only: filter }),
  });
  return (
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
  );
}

/**
 * Ajustes → Produtos → Vídeos relacionados (#1069): a cota do YouTube, o controle dos canais e as regras da busca (o
 * Conteúdo relacionado de Esportes e features). Antes só redirecionava; agora é a página.
 */
export default function RelatedVideosPage({ searchParams }: PageProps<'/[locale]/ajustes/videos'>) {
  return <OpsViewPage view="related" extra={() => Channels({ searchParams })} />;
}
