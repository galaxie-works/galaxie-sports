/**
 * Papel do processo (`APP_ROLE`): a mesma imagem da demo roda como dois serviços no compose da VPS, para um vazamento
 * no painel não derrubar o site e o portal de quem paga (issue #546).
 *
 * - `site`: o que é público e a demo (explorador de esportes), `/docs`, o exemplo, o embed e o registry dos widgets.
 * - `console`: o portal do cliente (`/cliente`, com o Builder em `/cliente/builder`) e o painel de operação (`/ajustes`),
 *   com as APIs deles.
 * - `all` (padrão, sem a variável): tudo num processo só, como no `next dev` e numa imagem antiga.
 *
 * O proxy responde 404 ao que é do outro papel; o Traefik manda cada caminho para o serviço certo pelo mesmo prefixo
 * (`CONSOLE_PATH_REGEXP`, conferido contra o `compose.yml` no teste). Rotas `comum` abrem nos dois: o login e a API do
 * auth (o Traefik as manda para o site, para o login da demo não depender do console), a versão, o proxy da API (o
 * Builder do console pré-visualiza por ele), a atividade do menu e os arquivos que o healthcheck e o navegador pedem.
 *
 * Puro: serve ao proxy, à partida do servidor, à rota de versão e aos testes.
 */
import { accessPathname } from '@/lib/auth/roles';

export const APP_ROLES = ['site', 'console', 'all'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Dono de um caminho: um dos dois papéis, ou os dois. */
export type RouteOwner = 'site' | 'console' | 'comum';

export interface RoleRoute {
  /** O próprio caminho e tudo abaixo dele (`/cliente` cobre `/cliente/builder/novo`, não `/clientes`). */
  path: string;
  owner: RouteOwner;
}

/**
 * Cada rota do app e o papel que a serve. Caminho sem entrada é do site (o explorador cresce sem mexer aqui); o teste
 * exige uma entrada para cada pasta de `app/`, então rota nova obriga a decidir. Vale a entrada mais longa.
 */
export const ROLE_ROUTES: readonly RoleRoute[] = [
  // ── console: portal do cliente (plano, chaves, canais, grade e o Builder) e painel de operação (só admin)
  { path: '/cliente', owner: 'console' },
  { path: '/api/cliente', owner: 'console' },
  { path: '/ajustes', owner: 'console' },
  { path: '/api/ajustes', owner: 'console' },

  // ── nos dois
  // login por código e a API do Better Auth: mesmo host, o cookie de sessão vale nos dois serviços
  { path: '/login', owner: 'comum' },
  { path: '/api/auth', owner: 'comum' },
  // telas do login antigo: redirecionam para o login
  { path: '/definir-senha', owner: 'comum' },
  { path: '/esqueci-senha', owner: 'comum' },
  // versão que o deploy e o smoke conferem em cada contêiner
  { path: '/api/version', owner: 'comum' },
  // proxy autenticado da API: explorador, docs, busca e a pré-visualização do Builder
  { path: '/api/galaxie', owner: 'comum' },
  // trilha de navegação do menu (as telas dos dois papéis)
  { path: '/api/atividade', owner: 'comum' },
  // token do torcedor da pessoa logada (#1020): o perfil de torcedor fica no menu dos dois papéis
  { path: '/api/torcedor', owner: 'comum' },
  // healthcheck da imagem (/robots.txt) e ícones da aba
  { path: '/robots.txt', owner: 'comum' },
  { path: '/icon.png', owner: 'comum' },
  { path: '/apple-icon.png', owner: 'comum' },
  { path: '/favicon.ico', owner: 'comum' },
  // arquivos do build: a mesma imagem tem os dos dois papéis
  { path: '/_next', owner: 'comum' },
  { path: '/__nextjs_original-stack-frames', owner: 'comum' },

  // ── site: público, demo, docs, exemplo, embed e registry
  { path: '/', owner: 'site' },
  { path: '/sobre', owner: 'site' },
  { path: '/termos', owner: 'site' },
  { path: '/privacidade', owner: 'site' },
  { path: '/sitemap.xml', owner: 'site' },
  { path: '/exemplo', owner: 'site' },
  { path: '/docs', owner: 'site' },
  { path: '/embed.js', owner: 'site' },
  { path: '/e', owner: 'site' },
  { path: '/r', owner: 'site' },
  { path: '/agenda', owner: 'site' },
  { path: '/ao-vivo', owner: 'site' },
  { path: '/classicos', owner: 'site' },
  { path: '/competicoes', owner: 'site' },
  { path: '/esportes', owner: 'site' },
  { path: '/eventos', owner: 'site' },
  { path: '/hipismo', owner: 'site' },
  { path: '/locais', owner: 'site' },
  { path: '/lutadores', owner: 'site' },
  { path: '/multiesporte', owner: 'site' },
  { path: '/paises', owner: 'site' },
  { path: '/pessoas', owner: 'site' },
  { path: '/pilotos', owner: 'site' },
  { path: '/times', owner: 'site' },
  // vídeo recusado no player do jogo
  { path: '/api/related', owner: 'site' },
  // imagem anexada a uma sugestão do app (link assinado que vai na issue)
  { path: '/api/feedback', owner: 'site' },
  // revalidação do cache pelo seguidor do change feed, que só roda no site (o console não tem o cache do explorador)
  { path: '/api/interno', owner: 'site' },
];

const covers = (route: string, path: string) =>
  route === '/' ? path === '/' : path === route || path.startsWith(`${route}/`);

/**
 * O dono de um caminho, decidido pelo caminho normalizado (`accessPathname`: decodificado, sem `..` nem o prefixo de
 * idioma), como o resto do proxy. `null` quando não decodifica.
 */
export function routeOwner(pathname: string): RouteOwner | null {
  const path = accessPathname(pathname);
  if (path === null) return null;
  let best: RoleRoute | undefined;
  for (const route of ROLE_ROUTES) {
    if (covers(route.path, path) && (!best || route.path.length > best.path.length)) best = route;
  }
  return best?.owner ?? 'site';
}

/** Este papel atende o caminho? (`all` atende tudo; num papel só, caminho que não decodifica é 404) */
export function servesPath(role: AppRole, pathname: string): boolean {
  if (role === 'all') return true;
  const owner = routeOwner(pathname);
  return owner === 'comum' || owner === role;
}

/** `APP_ROLE` do ambiente; vazio ou desconhecido é `all` (um processo com tudo, como antes da divisão). */
export function appRole(env: Record<string, string | undefined> = process.env): AppRole {
  const value = env.APP_ROLE?.trim();
  return (APP_ROLES as readonly string[]).includes(value ?? '') ? (value as AppRole) : 'all';
}

/** Nome do serviço no `/api/version` e no `build_info`: o do compose (`site`, `console`) ou `demo` com tudo junto. */
export const serviceName = (role: AppRole) => (role === 'all' ? 'demo' : role);

/** Caminhos do console, como o Traefik os casa (`PathRegexp` do router `gsports-console` no compose.yml). */
export const CONSOLE_PATHS = ROLE_ROUTES.filter((r) => r.owner === 'console')
  .map((r) => r.path)
  .sort();

export const CONSOLE_PATH_REGEXP = `^/(${CONSOLE_PATHS.map((p) => p.slice(1)).join('|')})(/|$)`;
