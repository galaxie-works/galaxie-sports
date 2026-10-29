/**
 * Script do embed HTML dos widgets (`<script src="https://sports.galaxie.works/embed.js" async>`): registra
 * `<galaxie-widget>`. O conteúdo vem empacotado de `@galaxie/widgets` (`scripts/build-embed.mjs`), com o
 * React junto, então a página do portal não precisa de build nem de framework. Público e igual para todos.
 */
import { EMBED_SCRIPT, EMBED_VERSION } from '@galaxie/widgets/embed-script';

const ETAG = `"${EMBED_VERSION}"`;

const HEADERS = {
  'content-type': 'application/javascript; charset=utf-8',
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
  etag: ETAG,
  // URL fixa: cache curto, revalidado pelo ETag, para uma correção chegar aos portais no mesmo dia
  'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
};

export function GET(request: Request) {
  if (request.headers.get('if-none-match') === ETAG)
    return new Response(null, { status: 304, headers: HEADERS });
  return new Response(EMBED_SCRIPT, { headers: HEADERS });
}
