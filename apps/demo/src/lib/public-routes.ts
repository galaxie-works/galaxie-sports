/**
 * O que abre sem sessão. Puro: serve ao proxy, ao robots.txt, ao sitemap e aos testes.
 *
 * Fora daqui, tudo exige login. A raiz (`/`) é um caso à parte: sem sessão, o proxy mostra a
 * apresentação no lugar de redirecionar, para que robôs e filtros web encontrem conteúdo no domínio.
 */

import { EXAMPLE_PAGES } from './example/pages';

/** Páginas públicas com conteúdo (entram no sitemap). A primeira é a apresentação. */
export const PUBLIC_PAGES = ['/sobre', '/termos', '/privacidade'] as const;

/** Página que a raiz mostra para quem não tem sessão. */
export const LANDING_PAGE = PUBLIC_PAGES[0];

/**
 * Arquivos abertos: os dos robôs (buscadores e filtros web) e os ícones da aba e da tela inicial
 * (`app/icon.png`, `app/apple-icon.png`; o `favicon.ico` já fica fora do proxy pelo matcher).
 */
export const PUBLIC_FILES = ['/robots.txt', '/sitemap.xml', '/icon.png', '/apple-icon.png'] as const;

/** Login e a API do próprio auth: públicos com tudo o que vem abaixo deles. */
const PUBLIC_PREFIXES = ['/login', '/api/auth'];

/**
 * Exemplo público (cópia gravada das páginas do app, sem a API): só as quatro páginas e as imagens
 * dele. Outro endereço em /exemplo cai na regra geral (login).
 */
const EXAMPLE_PATHS = EXAMPLE_PAGES.map((p) => `/exemplo/${p}`);
const EXAMPLE_IMAGES = '/exemplo/img/';

/**
 * Registry dos widgets do Builder (`/r/<id>.json`): o CLI do shadcn baixa sem sessão. Só o formato exato
 * (um segmento terminado em `.json`); o conteúdo não tem segredo (ver `app/r/[id]/route.ts`).
 */
const REGISTRY_ITEM = /^\/r\/[^/]+\.json$/;

const includes = (list: readonly string[], pathname: string) => list.includes(pathname);

/** O caminho abre sem sessão? (as páginas públicas só no endereço exato: `/sobre/x` exige login) */
export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    includes(PUBLIC_PAGES, pathname) ||
    includes(PUBLIC_FILES, pathname) ||
    includes(EXAMPLE_PATHS, pathname) ||
    pathname.startsWith(EXAMPLE_IMAGES) ||
    REGISTRY_ITEM.test(pathname)
  );
}
