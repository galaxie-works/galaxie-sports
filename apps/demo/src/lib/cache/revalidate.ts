/**
 * Revalida o cache da demo (`'use cache'` marcado com `cacheTag`) para as tags de uma mudança. Só funciona
 * dentro de uma requisição: a rota interna (que o seguidor do change feed chama) e as rotas da revisão.
 * Entidades e coleções editoriais expiram na hora; as coleções do ao vivo, em segundo plano (lib/cache/tags.ts).
 */
import { revalidateTag } from 'next/cache';

import { revalidateProfile } from './tags';

/**
 * Devolve quantas tags foram revalidadas. Uma falha só avisa no log: quem chama já gravou a mudança, e o
 * seguidor do change feed revalida as mesmas tags logo depois.
 */
export function revalidateApiTags(tags: Iterable<string>): number {
  let n = 0;
  for (const tag of new Set(tags)) {
    try {
      revalidateTag(tag, revalidateProfile(tag));
      n++;
    } catch (err) {
      console.warn('[demo-cache] revalidateTag falhou', { tag, err: String(err) });
    }
  }
  return n;
}
