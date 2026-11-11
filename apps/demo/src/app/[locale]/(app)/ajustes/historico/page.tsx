import type { Metadata } from 'next';

import { OpsViewPage } from '@/components/admin/ops-view-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.ops.nav.history };
}

/**
 * Ajustes → Plataforma → Histórico e auditoria (saía de Sistema). (#1069) O `?chave=` do "Ver no histórico" filtra a
 * leitura no banco; a promessa só é aberta dentro do Suspense do painel.
 */
export default function Page({ searchParams }: PageProps<'/[locale]/ajustes/historico'>) {
  const historyKey = searchParams.then((p) => (typeof p.chave === 'string' ? p.chave.slice(0, 120) : null));
  return <OpsViewPage view="history" historyKey={historyKey} />;
}
