/**
 * Marca as entradas de `'use cache'` com as tags da própria API: cada resposta traz no `surrogate-key` as
 * tags que a API purga quando o dado muda (as mesmas do `ops.change_feed`), e o fetch dos fetchers passa
 * essas tags para o `cacheTag`. Assim a demo revalida exatamente o que a API purgou (lib/cache/follower.ts).
 *
 * As tags explícitas de cada fetcher (`cacheTag(...)` em api.ts) cobrem o que a resposta não traz: 404
 * (perfil ainda não aprovado, tabela que ainda não existe) e respostas sem o header.
 */
import { cacheTag } from 'next/cache';

import { limitTags, parseSurrogateKey } from '../cache/tags';

/** Anexa tags à entrada de `'use cache'` em curso; fora de um `'use cache'` não há o que marcar. */
export function tagCacheEntry(tags: Iterable<string>): void {
  const valid = limitTags(tags);
  if (!valid.length) return;
  try {
    cacheTag(...valid);
  } catch {
    // chamada fora de 'use cache' (rota, server action, proxy da API): a resposta não fica em cache
  }
}

/** Tags do `surrogate-key` de uma resposta da API para a entrada em curso. */
export function tagFromResponse(res: Response): void {
  tagCacheEntry(parseSurrogateKey(res.headers.get('surrogate-key')));
}

/** fetch do cliente da API que marca a entrada de cache com as tags da resposta. */
export const taggedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  tagFromResponse(res);
  return res;
};
