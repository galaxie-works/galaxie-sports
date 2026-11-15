import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CATALOG_FAMILIES } from './builder/sports';
import {
  LEGACY_FAMILY_SLUGS,
  LEGACY_QUERY_PARAMS,
  LEGACY_QUERY_VALUES,
  LEGACY_ROUTES,
  legacyQueryTarget,
  legacyRedirectStatus,
  legacyRouteTarget,
  legacyTarget,
} from './legacy-routes';

const APP = join(__dirname, '..', 'app');

/** Pastas de `app/` que viram rota, com o caminho relativo (grupos de rota como `(app)` contam como pasta). */
function routeDirs(dir = APP, rel = ''): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const path = rel ? `${rel}/${d.name}` : d.name;
      return [path, ...routeDirs(join(dir, d.name), path)];
    });
}

/** A rota existe em `app/`? Segmento dinâmico (`[id]`, `[...key]`) aceita qualquer valor. */
function routeExists(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  const roots = segments[0] === 'api' ? [APP] : [join(APP, '[locale]'), join(APP, '[locale]', '(app)')];
  return roots.some((root) => {
    let dir = root;
    for (const segment of segments) {
      if (existsSync(join(dir, segment))) {
        dir = join(dir, segment);
        continue;
      }
      const dynamic = readdirSync(dir, { withFileTypes: true }).find(
        (d) => d.isDirectory() && d.name.startsWith('[') && d.name !== '[locale]',
      );
      if (!dynamic) return false;
      dir = join(dir, dynamic.name);
    }
    return true;
  });
}

describe('rotas antigas → novas (#630)', () => {
  it.each([
    ['/times', '/teams'],
    ['/times/1', '/teams/1'],
    ['/pt-BR/times/1', '/pt-BR/teams/1'],
    ['/en/eventos/abc', '/en/events/abc'],
    ['/es-AR/competicoes/libertadores', '/es-AR/competitions/libertadores'],
    ['/pt-br/agenda', '/pt-br/schedule'],
    ['/ao-vivo', '/live'],
    ['/classicos/gre-nal', '/derbies/gre-nal'],
    ['/esportes/futebol', '/sports/futebol'],
    ['/hipismo', '/equestrian'],
    ['/hipismo/atletas/1', '/equestrian/athletes/1'],
    ['/hipismo/campeonatos/gcl', '/equestrian/championships/gcl'],
    ['/hipismo/cavalos/2', '/equestrian/horses/2'],
    ['/hipismo/provas/3', '/equestrian/competitions/3'],
    ['/locais/1', '/venues/1'],
    ['/lutadores/x-1', '/fighters/x-1'],
    ['/multiesporte', '/multisport'],
    ['/paises/br', '/countries/br'],
    ['/pessoas/1', '/people/1'],
    ['/pilotos/x-1', '/drivers/x-1'],
    ['/sobre', '/about'],
    ['/termos', '/terms'],
    ['/privacidade', '/privacy'],
    ['/exemplo/jogo', '/example/match'],
    ['/exemplo/time', '/example/team'],
    ['/exemplo/campeonato', '/example/competition'],
    ['/exemplo/jogador', '/example/player'],
    ['/exemplo/img/a.png', '/example/img/a.png'],
    ['/docs/autenticacao', '/docs/authentication'],
    ['/docs/tempo-real', '/docs/realtime'],
    ['/cliente', '/client'],
    ['/cliente/builder/novo', '/client/builder/new'],
    ['/cliente/builder/123', '/client/builder/123'],
    ['/cliente/canais', '/client/channels'],
    ['/cliente/chaves', '/client/keys'],
    ['/cliente/grade', '/client/lineup'],
    ['/cliente/temas/novo', '/client/themes/new'],
    ['/cliente/temas/9', '/client/themes/9'],
    ['/ajustes', '/settings'],
    ['/ajustes/grades', '/settings/lineups'],
    ['/ajustes/revisao/abc', '/settings/review/abc'],
    ['/ajustes/usuarios/1', '/settings/users/1'],
    ['/ajustes/videos', '/settings/videos'],
    ['/ajustes/apps-de-tv', '/settings/tv-apps'],
    ['/ajustes/shopping/conectores', '/settings/shopping/connectors'],
    ['/ajustes/shopping/team/1', '/settings/shopping/team/1'],
    ['/api/ajustes/revisao/lote', '/api/settings/review/batch'],
    ['/api/ajustes/operacao', '/api/settings/operations'],
    ['/api/atividade', '/api/activity'],
    ['/api/cliente/cosmos/assistente', '/api/client/cosmos/assistant'],
    ['/api/interno/revalidar', '/api/internal/revalidate'],
    ['/api/feedback/anexo/2026-11/x.png', '/api/feedback/attachment/2026-11/x.png'],
    ['/api/torcedor/token', '/api/fan/token'],
  ])('%s → %s', (from, to) => expect(legacyRouteTarget(from)).toBe(to));

  it.each([
    '/',
    '/teams/1',
    '/pt-BR/events/1',
    '/settings/users',
    '/client',
    '/login',
    '/e/x.json',
    '/r/x.json',
    '/embed.js',
    '/api/galaxie/v1/teams',
    // prefixo de verdade, não pedaço do nome
    '/timesheet',
    '/clientes',
    '/ajustes-antigos',
    '/pt-BR',
    '/fr/times/1',
  ])('%s não é rota antiga', (path) => expect(legacyRouteTarget(path)).toBeNull());

  it('301 para quem lê, 308 para quem envia (repete método e corpo)', () => {
    expect(legacyRedirectStatus('GET')).toBe(301);
    expect(legacyRedirectStatus('HEAD')).toBe(301);
    expect(legacyRedirectStatus('POST')).toBe(308);
    expect(legacyRedirectStatus('DELETE')).toBe(308);
  });

  it('cada caminho antigo aparece uma vez, e nenhum destino é outro caminho antigo (um salto só)', () => {
    const from = LEGACY_ROUTES.map(([f]) => f);
    expect(from.length).toBe(new Set(from).size);
    for (const [, to] of LEGACY_ROUTES) expect(legacyRouteTarget(to), to).toBeNull();
  });

  it('cada destino existe em app/ (os itens "Em breve" de Ajustes caem na página de espera)', () => {
    const missing = LEGACY_ROUTES.map(([, to]) => to).filter((to) => !routeExists(to));
    expect(missing).toEqual([]);
  });
});

/**
 * Guarda (#630): as rotas são em inglês em todos os idiomas. Pasta nova em `app/` com um nome da coluna "Hoje" do mapa
 * da issue, ou com acento, reprova.
 */
describe('guarda das pastas de app/', () => {
  /** Coluna "Hoje" do mapa da issue #630, mais os segmentos antigos da tabela de redirecionamento. */
  const TODAY = new Set([
    'agenda',
    'ao-vivo',
    'classicos',
    'competicoes',
    'eventos',
    'esportes',
    'hipismo',
    'atletas',
    'campeonatos',
    'cavalos',
    'provas',
    'locais',
    'lutadores',
    'multiesporte',
    'paises',
    'pessoas',
    'pilotos',
    'times',
    'cliente',
    'canais',
    'chaves',
    'grade',
    'ajustes',
    'grades',
    'operacao',
    'revisao',
    'sistema',
    'usuarios',
    'autenticacao',
    'conceitos',
    'modulos-e-planos',
    'referencia',
    'tempo-real',
    'exemplo',
    '[pagina]',
    'sobre',
    'termos',
    'privacidade',
    'interno',
    'revalidar',
    'atividade',
    ...LEGACY_ROUTES.flatMap(([from, to]) => {
      const kept = new Set(to.split('/'));
      return from.split('/').filter((s) => s && !kept.has(s));
    }),
  ]);

  it('nenhuma pasta com nome em português do mapa', () => {
    const dirs = routeDirs();
    expect(dirs.length).toBeGreaterThan(50);
    const found = dirs.filter((path) => TODAY.has(path.split('/').at(-1)!));
    expect(found).toEqual([]);
  });

  it('nenhuma pasta com acento ou outro caractere fora do ASCII', () => {
    expect(routeDirs().filter((path) => /[^\x20-\x7e]/.test(path))).toEqual([]);
  });

  it('a guarda pega o que deveria', () => {
    expect(TODAY.has('times')).toBe(true);
    expect(TODAY.has('novo')).toBe(true);
    expect(TODAY.has('builder')).toBe(false);
    expect(TODAY.has('videos')).toBe(false);
    expect(/[^\x20-\x7e]/.test('notícias')).toBe(true);
  });
});

describe('slugs de família e query em português (#630)', () => {
  const q = (s: string) => legacyQueryTarget(new URLSearchParams(s))?.toString() ?? null;

  it.each([
    ['aba=jogos&temporada=2025', 'tab=matches&season=2025'],
    ['aba=classificacao', 'tab=standings'],
    ['detalhes=escalacao&escalacao=campo', 'details=lineups&lineup=pitch'],
    ['detalhes=minuto', 'details=timeline'],
    ['status=ao-vivo%2Cproximos&janela=24', 'status=live%2Cupcoming&window=24'],
    [
      'status=todos&pais=br&plataforma=x&tipo=plan_channel',
      'status=all&country=br&platform=x&type=plan_channel',
    ],
    ['esporte=futebol-americano', 'sport=american-football'],
    ['esporte=hipismo', 'sport=equestrian'],
    ['data=2026-10-23&rodada=Rodada+32', 'date=2026-10-23&round=Rodada+32'],
    ['chave=AI_RIGHTS_MODEL', 'key=AI_RIGHTS_MODEL'],
    ['motivo=expirado&voltar=%2Fteams%2F1', 'reason=expired&next=%2Fteams%2F1'],
    // o nome novo, quando já veio, vale mais que o antigo
    ['aba=jogos&tab=standings', 'tab=standings'],
    // parâmetro sem tradução segue como está, na mesma ordem
    ['q=verd%C3%A3o&tipo=team', 'q=verd%C3%A3o&type=team'],
  ])('?%s → ?%s', (from, to) => expect(q(from)).toBe(to));

  it.each(['tab=matches&season=2025', 'status=live', 'sport=football', 'q=jogos', ''])(
    '?%s já está em inglês',
    (search) => expect(q(search)).toBeNull(),
  );

  it.each([
    ['/esportes/futebol', '', '/sports/football'],
    ['/pt-BR/esportes/basquete', 'aba=jogos', '/pt-BR/sports/basketball?tab=matches'],
    ['/sports/futebol-australiano', '', '/sports/australian-football'],
    ['/competitions/x', 'temporada=2025', '/competitions/x?season=2025'],
    ['/times/1', 'temporada=2025&q=a', '/teams/1?season=2025&q=a'],
  ])('%s?%s → %s', (path, search, to) =>
    expect(legacyTarget(path, new URLSearchParams(search), true)).toBe(to),
  );

  it('nada antigo: null; rota de API não traduz a query', () => {
    expect(legacyTarget('/sports/football', new URLSearchParams('tab=matches'), true)).toBeNull();
    expect(legacyTarget('/sports/futebol/extra', new URLSearchParams(), true)).toBeNull();
    expect(legacyTarget('/api/galaxie/v1/teams', new URLSearchParams('tipo=x'), false)).toBeNull();
    expect(legacyTarget('/api/atividade', new URLSearchParams('tipo=x'), false)).toBe('/api/activity?tipo=x');
  });

  it('nomes e valores novos em inglês, sem acento, e nenhum nome antigo é também um nome novo', () => {
    const fresh = new Set(Object.values(LEGACY_QUERY_PARAMS));
    for (const [from, to] of Object.entries(LEGACY_QUERY_PARAMS)) {
      expect(to, from).toMatch(/^[a-z]+$/);
      expect(fresh.has(from), from).toBe(false);
    }
    for (const values of Object.values(LEGACY_QUERY_VALUES))
      for (const to of Object.values(values)) expect(to).toMatch(/^[a-z0-9-]+$/);
  });

  it('guarda: toda família do menu e do catálogo do Builder tem slug em inglês, e o antigo leva a ele', () => {
    for (const f of CATALOG_FAMILIES) {
      expect(Object.hasOwn(LEGACY_FAMILY_SLUGS, f.slug), f.slug).toBe(false);
      expect(f.slug, f.id).toMatch(/^[a-z0-9-]+$/);
      expect(LEGACY_FAMILY_SLUGS[f.id], f.id).toBe(f.slug);
    }
  });
});
