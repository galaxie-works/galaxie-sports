/**
 * Contagens do menu de Ajustes (só no servidor, #1068): o que espera ação na Revisão do catálogo e nos pedidos das
 * operadoras (Grades e ofertas), e a soma no Início. Os mesmos dados das páginas, lidos por requisição; o que não der
 * para ler fica sem selo (null), sem derrubar o menu.
 */
import { connection } from 'next/server';

import type { SettingsNavCounts } from '@/components/admin/settings-nav';
import { countOpenLineupRequests } from '@/lib/lineup/server';
import { countReviewQueue } from '@/lib/review/store';

const orNull = (p: Promise<number>) => p.catch(() => null);

export async function settingsNavCounts(): Promise<SettingsNavCounts> {
  await connection();
  const [review, lineup] = await Promise.all([orNull(countReviewQueue()), orNull(countOpenLineupRequests())]);
  const home = review === null && lineup === null ? null : (review ?? 0) + (lineup ?? 0);
  return { home, review, lineup };
}
