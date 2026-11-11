import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SoonPage } from '@/components/admin/soon-page';
import { getT } from '@/lib/i18n/server';
import { SOON_ITEMS, soonItemBySlug, soonSlug } from '@/lib/ops/settings-items';

/** Os 23 itens planejados de Ajustes (#1068) são fixos: `params` não é dado de requisição (prerender por idioma). */
export function generateStaticParams() {
  return SOON_ITEMS.map((item) => ({ soon: soonSlug(item) }));
}

export async function generateMetadata({ params }: PageProps<'/[locale]/ajustes/[soon]'>): Promise<Metadata> {
  const item = soonItemBySlug((await params).soon);
  if (!item) return {};
  const t = await getT();
  return { title: t.ops.nav[item.id] };
}

/**
 * Ajustes → um item "Em breve" (Apps de TV, Chat ao vivo, Planos e preços…): a página de espera. As rotas das telas que
 * já existem são pastas próprias e têm precedência sobre esta; caminho que não é de um item planejado dá 404.
 */
export default async function SoonItemPage({ params }: PageProps<'/[locale]/ajustes/[soon]'>) {
  const item = soonItemBySlug((await params).soon);
  if (!item) notFound();
  return <SoonPage id={item.id} />;
}
