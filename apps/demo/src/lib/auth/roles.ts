/**
 * Papéis da demo e o que cada um abre. Módulo puro: serve ao proxy, às páginas, às ações e aos testes.
 *
 * - `admin`: gerencia usuários e a operação (Ajustes) e vê o painel do cliente de qualquer tenant.
 * - `user`: convidado, só navega na demo.
 * - `client`: operadora cliente, ligada a um tenant da API (`api.tenant`). Navega na demo e tem o painel
 *   do cliente (`/cliente`): plano, chaves publicáveis e o Builder de widgets, sempre do próprio tenant.
 */

export const ROLES = ['admin', 'user', 'client'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

/** Papel gravado no banco → papel da demo (valor desconhecido ou vazio = convidado). */
export const roleOf = (value: unknown): Role => (isRole(value) ? value : 'user');

/** Área de admin: páginas de ajustes e as rotas de API delas. */
export const ADMIN_PREFIXES = ['/ajustes', '/api/ajustes'] as const;

/** Painel do cliente: páginas e rotas de API. */
export const CLIENT_PREFIXES = ['/cliente', '/api/cliente'] as const;

export const matchesPrefix = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Abre a área de admin? */
export const canAccessAdmin = (role: unknown) => role === 'admin';

/** Abre o painel do cliente? (o admin entra para acompanhar um tenant) */
export const canAccessClientPanel = (role: unknown) => role === 'admin' || role === 'client';

/** Cliente precisa de tenant; os outros papéis não ficam ligados a nenhum. */
export const needsTenant = (role: Role) => role === 'client';

/**
 * O que o proxy faz com um caminho que exige sessão: segue, ou nega (403 na API, volta para a home nas
 * páginas). Prazo de acesso e sessão ficam com o proxy; aqui só o papel.
 */
export function routeAccess(pathname: string, role: unknown): 'allow' | 'deny' {
  if (matchesPrefix(pathname, ADMIN_PREFIXES)) return canAccessAdmin(role) ? 'allow' : 'deny';
  if (matchesPrefix(pathname, CLIENT_PREFIXES)) return canAccessClientPanel(role) ? 'allow' : 'deny';
  return 'allow';
}
