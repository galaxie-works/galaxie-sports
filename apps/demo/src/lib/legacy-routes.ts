/**
 * Rotas em português de antes do #630 e para onde foram. Desde 15/11/2026 toda rota da plataforma e do console é em
 * inglês em todos os idiomas (`/pt-BR/events/123`, `/en/events/123`): só o texto muda com o idioma. O proxy responde
 * com redirecionamento permanente de cada caminho antigo para o novo, com ou sem o prefixo de idioma, mantendo o resto
 * do caminho e a query (`/pt-BR/times/1?aba=elenco` → `/pt-BR/teams/1?aba=elenco`).
 *
 * Vale por 12 meses, de 15/11/2026 a 15/11/2027 (issue #630): depois, retirar esta tabela, os caminhos antigos do
 * console em `ROLE_ROUTES` (`lib/app-role.ts`) e os prefixos `ajustes` e `cliente` do `PathRegexp` do Traefik
 * (`infra/vps-telemetry/compose.yml`).
 *
 * Puro: serve ao proxy, aos testes e à guarda das pastas de `app/` (`legacy-routes.test.ts`).
 */
import { LOCALES } from '@/lib/i18n/config';

/**
 * Caminho antigo → caminho novo. Vale o prefixo mais longo que casar segmento a segmento (`/hipismo/atletas/1` usa a
 * linha de `/hipismo/atletas`, não a de `/hipismo`). Os itens "Em breve" de Ajustes também estão aqui: o link antigo
 * deles pode estar salvo.
 */
export const LEGACY_ROUTES: readonly (readonly [string, string])[] = [
  // ── explorador (site)
  ['/agenda', '/schedule'],
  ['/ao-vivo', '/live'],
  ['/classicos', '/derbies'],
  ['/competicoes', '/competitions'],
  ['/eventos', '/events'],
  ['/esportes', '/sports'],
  ['/hipismo', '/equestrian'],
  ['/hipismo/atletas', '/equestrian/athletes'],
  ['/hipismo/campeonatos', '/equestrian/championships'],
  ['/hipismo/cavalos', '/equestrian/horses'],
  ['/hipismo/provas', '/equestrian/competitions'],
  ['/locais', '/venues'],
  ['/lutadores', '/fighters'],
  ['/multiesporte', '/multisport'],
  ['/paises', '/countries'],
  ['/pessoas', '/people'],
  ['/pilotos', '/drivers'],
  ['/times', '/teams'],

  // ── páginas públicas, exemplo e guias da API (site)
  ['/sobre', '/about'],
  ['/termos', '/terms'],
  ['/privacidade', '/privacy'],
  ['/exemplo', '/example'],
  ['/exemplo/jogo', '/example/match'],
  ['/exemplo/time', '/example/team'],
  ['/exemplo/campeonato', '/example/competition'],
  ['/exemplo/jogador', '/example/player'],
  ['/docs/autenticacao', '/docs/authentication'],
  ['/docs/conceitos', '/docs/concepts'],
  ['/docs/modulos-e-planos', '/docs/modules-and-plans'],
  ['/docs/referencia', '/docs/reference'],
  ['/docs/tempo-real', '/docs/realtime'],

  // ── portal do cliente (console)
  ['/cliente', '/client'],
  ['/cliente/builder/novo', '/client/builder/new'],
  ['/cliente/canais', '/client/channels'],
  ['/cliente/chaves', '/client/keys'],
  ['/cliente/grade', '/client/lineup'],
  ['/cliente/moderacao', '/client/moderation'],
  ['/cliente/patrocinadores', '/client/sponsors'],
  ['/cliente/planos', '/client/plans'],
  ['/cliente/temas', '/client/themes'],
  ['/cliente/temas/novo', '/client/themes/new'],
  ['/cliente/usuarios', '/client/users'],

  // ── Ajustes (console), com os itens "Em breve"
  ['/ajustes', '/settings'],
  ['/ajustes/agenda', '/settings/schedule'],
  ['/ajustes/ao-vivo', '/settings/live'],
  ['/ajustes/apps-de-tv', '/settings/tv-apps'],
  ['/ajustes/cadastros', '/settings/signups'],
  ['/ajustes/carteiras', '/settings/wallets'],
  ['/ajustes/catalogo', '/settings/catalog'],
  ['/ajustes/chat-ao-vivo', '/settings/live-chat'],
  ['/ajustes/comunidades', '/settings/communities'],
  ['/ajustes/credenciais', '/settings/credentials'],
  ['/ajustes/dominios', '/settings/domains'],
  ['/ajustes/escudos', '/settings/crests'],
  ['/ajustes/espelho', '/settings/mirror'],
  ['/ajustes/ficha-por-pais', '/settings/country-profile'],
  ['/ajustes/fornecedor', '/settings/provider'],
  ['/ajustes/gamificacao', '/settings/gamification'],
  ['/ajustes/grades', '/settings/lineups'],
  ['/ajustes/guarda-legal', '/settings/legal-hold'],
  ['/ajustes/historico', '/settings/history'],
  ['/ajustes/ia', '/settings/ai'],
  ['/ajustes/idiomas', '/settings/languages'],
  ['/ajustes/lance-a-lance', '/settings/play-by-play'],
  ['/ajustes/medicao', '/settings/metering'],
  ['/ajustes/moderacao', '/settings/moderation'],
  ['/ajustes/modulos', '/settings/modules'],
  ['/ajustes/onde-assistir', '/settings/where-to-watch'],
  ['/ajustes/organizacoes', '/settings/organizations'],
  ['/ajustes/planos', '/settings/plans'],
  ['/ajustes/pos-jogo', '/settings/post-game'],
  ['/ajustes/publicidade', '/settings/advertising'],
  ['/ajustes/qualidade', '/settings/quality'],
  ['/ajustes/revisao', '/settings/review'],
  ['/ajustes/segunda-apelacao', '/settings/second-appeal'],
  ['/ajustes/shopping/conectores', '/settings/shopping/connectors'],
  ['/ajustes/sugestoes', '/settings/suggestions'],
  ['/ajustes/tarefas', '/settings/tasks'],
  ['/ajustes/termos', '/settings/terms'],
  ['/ajustes/torcedor', '/settings/fan-identity'],
  ['/ajustes/usuarios', '/settings/users'],

  // ── rotas internas da API da demo
  ['/api/ajustes', '/api/settings'],
  ['/api/ajustes/operacao', '/api/settings/operations'],
  ['/api/ajustes/revisao', '/api/settings/review'],
  ['/api/ajustes/revisao/lote', '/api/settings/review/batch'],
  ['/api/atividade', '/api/activity'],
  ['/api/cliente', '/api/client'],
  ['/api/cliente/cosmos/assistente', '/api/client/cosmos/assistant'],
  ['/api/cliente/cosmos/extrato', '/api/client/cosmos/statement'],
  ['/api/cliente/cosmos/tema', '/api/client/cosmos/theme'],
  ['/api/cliente/shopping/relatorio', '/api/client/shopping/report'],
  ['/api/feedback/anexo', '/api/feedback/attachment'],
  ['/api/interno', '/api/internal'],
  ['/api/interno/revalidar', '/api/internal/revalidate'],
  ['/api/torcedor', '/api/fan'],
];

/** Pares do mais longo para o mais curto: o primeiro que casar é o mais específico. */
const BY_LENGTH = [...LEGACY_ROUTES].sort((a, b) => b[0].length - a[0].length);

/** Prefixo de idioma no começo do caminho (`/pt-BR`, `/en`, `/es-AR`), como a pessoa digitou. */
const LOCALE_PREFIX = new RegExp(`^/(${LOCALES.join('|')})(?=/|$)`, 'i');

/**
 * Caminho novo de um caminho antigo, com o mesmo prefixo de idioma e o resto do caminho; null quando não é rota
 * antiga. Só o caminho: quem chama devolve a query junto.
 */
export function legacyRouteTarget(pathname: string): string | null {
  const prefix = LOCALE_PREFIX.exec(pathname)?.[0] ?? '';
  const path = pathname.slice(prefix.length) || '/';
  for (const [from, to] of BY_LENGTH) {
    if (path === from || path.startsWith(`${from}/`)) return `${prefix}${to}${path.slice(from.length)}`;
  }
  return null;
}

/**
 * Status do redirecionamento: 301 para quem lê (GET e HEAD) e 308 para o resto, que precisa repetir o método e o
 * corpo (um POST de uma aba aberta antes do deploy).
 */
export const legacyRedirectStatus = (method: string): 301 | 308 =>
  method === 'GET' || method === 'HEAD' ? 301 : 308;
