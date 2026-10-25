/**
 * Papéis da demo e o que cada um abre. Módulo puro: serve ao proxy, às páginas, às ações e aos testes.
 *
 * - `admin`: gerencia usuários e a operação (Ajustes) e vê o painel do cliente de qualquer tenant.
 * - `user`: convidado, só navega na demo.
 * - `client`: operadora cliente, ligada a um tenant da API (`api.tenant`). Navega na demo e tem o painel
 *   do cliente (`/cliente`): plano, chaves publicáveis e o Builder de widgets, sempre do próprio tenant.
 */

import { LOCALES } from '@/lib/i18n/config';

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

const LOCALE_SEGMENTS = new Set(LOCALES.map((l) => l.toLowerCase()));

/**
 * Caminho como as rotas o enxergam, para decidir o acesso: decodificado (`/%61justes` → `/ajustes`),
 * com `\`, `.`, `..` e barras repetidas resolvidos e sem o prefixo de idioma (`/pt-BR/ajustes` →
 * `/ajustes`, o segmento que o proxy acrescenta ao reescrever). Na dúvida, fica mais restrito: decodifica
 * até estabilizar, então um caminho codificado duas vezes também cai na área certa.
 */
export function accessPathname(pathname: string): string {
  let path = pathname;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      break; // codificação inválida: fica como veio
    }
    if (decoded === path) break;
    path = decoded;
  }
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  while (segments.length && LOCALE_SEGMENTS.has(segments[0]!.toLowerCase())) segments.shift();
  return `/${segments.join('/')}`;
}

/**
 * O que o proxy faz com um caminho que exige sessão: segue, ou nega (403 na API, volta para a home nas
 * páginas). Prazo de acesso e sessão ficam com o proxy; aqui só o papel. Decide pelo caminho normalizado
 * (`accessPathname`), não pelo texto cru da URL.
 */
export function routeAccess(pathname: string, role: unknown): 'allow' | 'deny' {
  const path = accessPathname(pathname);
  if (matchesPrefix(path, ADMIN_PREFIXES)) return canAccessAdmin(role) ? 'allow' : 'deny';
  if (matchesPrefix(path, CLIENT_PREFIXES)) return canAccessClientPanel(role) ? 'allow' : 'deny';
  return 'allow';
}
