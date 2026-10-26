/**
 * Revalida o cache da demo (`'use cache'` marcado com `cacheTag`) para as tags de uma mudança. Só funciona
 * dentro de uma requisição: a rota interna (que o seguidor do change feed chama) e as rotas da revisão.
 * Entidades e coleções editoriais expiram na hora; as coleções do ao vivo, em segundo plano (lib/cache/tags.ts).
 */
import { revalidateTag } from 'next/cache';

import { revalidateProfile } from './tags';

export interface RevalidateOutcome {
  revalidated: number;
  /** Tags em que o `revalidateTag` falhou. */
  failed: string[];
}

/**
 * Tenta todas as tags e devolve as que falharam: a rota interna responde erro (e o seguidor não avança o
 * cursor); as rotas da revisão só avisam no log, porque a decisão já foi gravada e o seguidor revalida as
 * mesmas tags logo depois.
 */
export function revalidateApiTags(tags: Iterable<string>): RevalidateOutcome {
  const outcome: RevalidateOutcome = { revalidated: 0, failed: [] };
  for (const tag of new Set(tags)) {
    try {
      revalidateTag(tag, revalidateProfile(tag));
      outcome.revalidated++;
    } catch (err) {
      outcome.failed.push(tag);
      console.warn('[demo-cache] revalidateTag falhou', { tag, err: String(err) });
    }
  }
  return outcome;
}
