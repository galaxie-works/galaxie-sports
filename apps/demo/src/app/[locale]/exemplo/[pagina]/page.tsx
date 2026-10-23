import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { CompetitionContent, competitionMetadata } from '@/components/pages/competition-page';
import { EventContent, EventFallback, eventMetadata } from '@/components/pages/event-page';
import { PersonContent, personMetadata } from '@/components/pages/person-page';
import { TeamContent, teamMetadata } from '@/components/pages/team-page';
import { EXAMPLE_PAGES, exampleIds, isExamplePage, type ExamplePage } from '@/lib/example/pages';
import { snapshotSource } from '@/lib/example/snapshot';
import { getLocale } from '@/lib/i18n/server';

const PAGES = {
  jogo: { Content: EventContent, metadata: eventMetadata },
  time: { Content: TeamContent, metadata: teamMetadata },
  campeonato: { Content: CompetitionContent, metadata: competitionMetadata },
  jogador: { Content: PersonContent, metadata: personMetadata },
} satisfies Record<ExamplePage, unknown>;

/** As quatro páginas do exemplo são fixas: `params` não é dado de requisição (prerender por idioma). */
export function generateStaticParams() {
  return EXAMPLE_PAGES.map((pagina) => ({ pagina }));
}

/** Só a temporada e a data gravadas: o exemplo ignora a troca delas (e o país do onde assistir). */
const IGNORED_QUERY = new Set(['temporada', 'data', 'pais']);

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/exemplo/[pagina]'>): Promise<Metadata> {
  const { pagina } = await params;
  if (!isExamplePage(pagina)) return {};
  const id = exampleIds(await getLocale())[pagina];
  // fora dos buscadores: é uma cópia das telas da demo, não conteúdo para indexar
  return { ...(await PAGES[pagina].metadata(id, snapshotSource)), robots: { index: false, follow: false } };
}

/** Conteúdo da página, dentro do `Suspense`: a página e a query string (abas) são dados de URL. */
async function Example({ params, searchParams }: PageProps<'/[locale]/exemplo/[pagina]'>) {
  const [{ pagina }, raw, locale] = await Promise.all([params, searchParams, getLocale()]);
  if (!isExamplePage(pagina)) notFound();
  const query = Object.fromEntries(Object.entries(raw).filter(([k]) => !IGNORED_QUERY.has(k)));
  const { Content } = PAGES[pagina];
  return (
    <Content
      params={Promise.resolve({ id: exampleIds(locale)[pagina] })}
      searchParams={Promise.resolve(query)}
      source={snapshotSource}
    />
  );
}

/**
 * Página do exemplo público: o mesmo conteúdo da página do app (jogo, time, campeonato ou jogador),
 * com a cópia gravada no lugar da API.
 */
export default function ExamplePage(props: PageProps<'/[locale]/exemplo/[pagina]'>) {
  return (
    <Suspense fallback={<EventFallback />}>
      <Example {...props} />
    </Suspense>
  );
}
