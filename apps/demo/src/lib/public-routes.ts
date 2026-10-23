/**
 * O que abre sem sessão. Puro: serve ao proxy, ao robots.txt, ao sitemap e aos testes.
 *
 * Fora daqui, tudo exige login. A raiz (`/`) é um caso à parte: sem sessão, o proxy mostra a
 * apresentação no lugar de redirecionar, para que robôs e filtros web encontrem conteúdo no domínio.
 */

/** Páginas públicas com conteúdo (entram no sitemap). A primeira é a apresentação. */
export const PUBLIC_PAGES = ['/sobre', '/termos', '/privacidade'] as const;

/** Página que a raiz mostra para quem não tem sessão. */
export const LANDING_PAGE = PUBLIC_PAGES[0];

/** Arquivos para robôs (buscadores e filtros web). */
export const ROBOTS_FILES = ['/robots.txt', '/sitemap.xml'] as const;

/** Login e a API do próprio auth: públicos com tudo o que vem abaixo deles. */
const PUBLIC_PREFIXES = ['/login', '/api/auth'];

const includes = (list: readonly string[], pathname: string) => list.includes(pathname);

/** O caminho abre sem sessão? (as páginas públicas só no endereço exato: `/sobre/x` exige login) */
export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    includes(PUBLIC_PAGES, pathname) ||
    includes(ROBOTS_FILES, pathname)
  );
}
