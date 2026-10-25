/**
 * Tags do cache da demo (`'use cache'` + `cacheTag`): o mesmo vocabulário das respostas da API e do
 * `ops.change_feed` (docs/05 §7) — `team:<id>`, `event:<id>`, `related_content:<id>`, `f1_editorial`,
 * `standing`... Uma mudança no change feed vira as tags de `tagsForChange` (@galaxie/db): a API purga o
 * Valkey e a CDN com elas, e a demo revalida as próprias entradas com as mesmas (lib/cache/follower.ts).
 *
 * Puro: serve ao fetch da API, à rota de revalidação e aos testes.
 */

/** Teto do Next por tag (mais longa é ignorada pelo `cacheTag`). */
export const MAX_TAG_LENGTH = 256;
/** Teto do Next por chamada de `cacheTag`. */
export const MAX_TAGS_PER_CALL = 128;
/** Tags de uma resposta da API anexadas a uma entrada do cache (listas longas viram a coleção). */
export const MAX_TAGS_PER_RESPONSE = 64;

/**
 * Coleções que os writers do ao vivo publicam o tempo todo (placar e status pelos triggers de
 * `core.event`, onde assistir, contexto, vídeos relacionados, tabela recalculada depois do jogo). Elas
 * revalidam com `max` (stale-while-revalidate: a visita seguinte recebe o que está no cache e dispara a
 * atualização), senão toda página com uma lista de jogos esperaria a API a cada gol. As demais tags —
 * entidades (`team:<id>`) e coleções editoriais (`f1_editorial`, `team_profile`) — expiram na hora.
 */
export const BUSY_TAGS: ReadonlySet<string> = new Set([
  'event',
  'where_to_watch',
  'event_context',
  'related_content',
  'standing',
  'season',
]);

export type RevalidateProfile = 'max' | { expire: number };

/** Perfil do `revalidateTag` de cada tag (ver BUSY_TAGS). */
export function revalidateProfile(tag: string): RevalidateProfile {
  return BUSY_TAGS.has(tag) ? 'max' : { expire: 0 };
}

/** Tags do header `surrogate-key` da API (separadas por espaço). */
export function parseSurrogateKey(header: string | null | undefined): string[] {
  if (!header) return [];
  return [...new Set(header.split(/\s+/).filter(Boolean))];
}

const collectionOf = (tag: string) => {
  const i = tag.indexOf(':');
  return i < 0 ? null : tag.slice(0, i);
};

/**
 * Tags prontas para `cacheTag`: sem repetidas, vazias ou longas demais. Acima de `max`, as coleções com
 * mais entidades viram só a coleção (`event:1 event:2 …` → `event`), da maior para a menor, até caber:
 * a coleção é revalidada por qualquer mudança daquele tipo, então cobre as entidades que saíram, e as
 * tags raras (`competition:<id>`, `standing:<id>`) continuam precisas.
 */
export function limitTags(tags: Iterable<string>, max = MAX_TAGS_PER_RESPONSE): string[] {
  const unique = [...new Set(tags)].filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH);
  if (unique.length <= max) return unique;
  const plain = new Set<string>();
  const groups = new Map<string, string[]>();
  for (const tag of unique) {
    const collection = collectionOf(tag);
    if (collection === null) plain.add(tag);
    else groups.set(collection, [...(groups.get(collection) ?? []), tag]);
  }
  let count = unique.length;
  for (const [collection, entities] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    if (count <= max) break;
    groups.delete(collection);
    count -= entities.length;
    if (!plain.has(collection)) {
      plain.add(collection);
      count += 1;
    }
  }
  return [...plain, ...[...groups.values()].flat()].slice(0, MAX_TAGS_PER_CALL);
}

/** Corpo da rota interna de revalidação: só strings válidas, sem repetidas. */
export function parseTagList(value: unknown, max = 2_000): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const tags = value.filter(
    (t): t is string => typeof t === 'string' && t.length > 0 && t.length <= MAX_TAG_LENGTH,
  );
  return [...new Set(tags)];
}
