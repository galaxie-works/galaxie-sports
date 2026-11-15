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
  match: { Content: EventContent, metadata: eventMetadata },
  team: { Content: TeamContent, metadata: teamMetadata },
  competition: { Content: CompetitionContent, metadata: competitionMetadata },
  player: { Content: PersonContent, metadata: personMetadata },
} satisfies Record<ExamplePage, unknown>;

/** As quatro páginas do exemplo são fixas: `params` não é dado de requisição (prerender por idioma). */
export function generateStaticParams() {
  return EXAMPLE_PAGES.map((page) => ({ page }));
}

/** Só a temporada e a data gravadas: o exemplo ignora a troca delas (e o país do onde assistir). */
const IGNORED_QUERY = new Set(['temporada', 'data', 'pais']);

export async function generateMetadata({ params }: PageProps<'/[locale]/example/[page]'>): Promise<Metadata> {
  const { page } = await params;
  if (!isExamplePage(page)) return {};
  const id = exampleIds(await getLocale())[page];
  // fora dos buscadores: é uma cópia das telas da demo, não conteúdo para indexar
  return { ...(await PAGES[page].metadata(id, snapshotSource)), robots: { index: false, follow: false } };
}

/** Conteúdo da página, dentro do `Suspense`: a página e a query string (abas) são dados de URL. */
async function Example({ params, searchParams }: PageProps<'/[locale]/example/[page]'>) {
  const [{ page }, raw, locale] = await Promise.all([params, searchParams, getLocale()]);
  if (!isExamplePage(page)) notFound();
  const query = Object.fromEntries(Object.entries(raw).filter(([k]) => !IGNORED_QUERY.has(k)));
  const { Content } = PAGES[page];
  return (
    <Content
      params={Promise.resolve({ id: exampleIds(locale)[page] })}
      searchParams={Promise.resolve(query)}
      source={snapshotSource}
    />
  );
}

/**
 * Página do exemplo público: o mesmo conteúdo da página do app (jogo, time, campeonato ou jogador),
 * com a cópia gravada no lugar da API.
 */
export default function ExamplePage(props: PageProps<'/[locale]/example/[page]'>) {
  return (
    <Suspense fallback={<EventFallback />}>
      <Example {...props} />
    </Suspense>
  );
}
