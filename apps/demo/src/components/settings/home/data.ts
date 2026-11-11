/**
 * Fontes do Início de Ajustes (#1073), só no servidor: as mesmas leituras das páginas de hoje (fila da Revisão,
 * pedidos das operadoras e o retrato do painel de Operação). Cada fonte falha sozinha: o cartão dela fica "Sem dados
 * agora" e os outros seguem. Quem chama já conferiu a sessão (`requireAdmin`).
 */
import { countOpenLineupRequests } from '@/lib/lineup/server';
import { readOpsSnapshot } from '@/lib/ops/data';
import { listReviewItems } from '@/lib/review/store';
import { parseFilters } from '@/lib/review/types';
import type { Dictionary } from '@/lib/i18n/dictionary';

import {
  HOME_LINKS,
  buildHomeCards,
  recentChanges,
  type HomeCard,
  type HomeCardId,
  type HomeSources,
} from './home-cards';

/** Só a contagem por situação interessa: a menor página, sem filtro. */
async function readReviewPending(words: Dictionary['review']['summary']): Promise<HomeSources['review']> {
  const data = await listReviewItems({ ...parseFilters({}), per: 25 }, words);
  return { pending: data.counts.needs_review };
}

/** Os abertos filtrados no banco, a mesma contagem do selo do menu (`settingsNavCounts`). */
async function readOpenRequests(): Promise<HomeSources['requests']> {
  return { open: await countOpenLineupRequests() };
}

/** `null` quando a fonte falha (tabela não migrada, banco fora), sem derrubar o Início. */
const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export interface SettingsHomeData {
  cards: HomeCard[];
  recent: ReturnType<typeof recentChanges>;
  /** Quando o retrato do painel foi lido (ISO); null sem ele. */
  generatedAt: string | null;
}

/** Junta as fontes e monta os cartões e as últimas mudanças. */
export async function readSettingsHome(
  words: Dictionary['review']['summary'],
  links: Record<HomeCardId, string | null> = HOME_LINKS,
): Promise<SettingsHomeData> {
  const [review, requests, ops] = await Promise.all([
    orNull(readReviewPending(words)),
    orNull(readOpenRequests()),
    orNull(readOpsSnapshot()),
  ]);
  return {
    cards: buildHomeCards({ review, requests, ops }, links),
    recent: recentChanges(ops),
    generatedAt: ops?.generatedAt ?? null,
  };
}
