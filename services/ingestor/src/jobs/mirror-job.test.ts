import { FREE_PLAN, PlanRules, PRO_PLAN, ULTRA_PLAN } from '@galaxie/apisports-client';
import {
  MIRROR_CATALOG,
  MIRROR_INVENTORY_CURSOR,
  mirrorConfig,
  parseMirrorInventory,
} from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';
import { fakeCatalog, NOW } from '../testing/fake-api.js';
import { StaticCatalogSource } from './catalog-source.js';
import {
  arrangeGroups,
  footballGroups,
  inPlay,
  SPORT_MIRROR,
  type OtherSport,
  mirrorBudget,
  mirrorJobs,
  rotateGroups,
  sportGroups,
  type MirrorCandidate,
  type SportMirrorSource,
} from './mirror-job.js';
import { InMemoryCursorStore } from './runtime/cursor-store.js';
import { InMemoryRawSource } from './runtime/raw-source.js';
import { plannedRequest } from './runtime/runner.js';

const DAY = 86_400_000;
const now = new Date(NOW);
const url = (i: { endpoint: string; params: Record<string, string> }) =>
  `${i.endpoint}?${new URLSearchParams(i.params)}`;
const noDerbies = async () => [];

describe('inPlay e orçamento', () => {
  it('temporada atual, próxima em até 14 dias e encerrada há até 7', () => {
    expect(inPlay({ current: true, startDate: null, endDate: null }, now)).toBe(true);
    expect(inPlay({ current: false, startDate: '2026-10-30', endDate: '2027-05-01' }, now)).toBe(true);
    expect(inPlay({ current: false, startDate: '2026-12-01', endDate: '2027-05-01' }, now)).toBe(false);
    expect(inPlay({ current: true, startDate: '2026-01-01', endDate: '2026-10-01' }, now)).toBe(false);
    expect(inPlay({ current: false, startDate: null, endDate: null }, now)).toBe(false);
  });

  it('20% da cota nos pagos e 10 no free', () => {
    expect(mirrorBudget(ULTRA_PLAN)).toBe(15000);
    expect(mirrorBudget(PRO_PLAN)).toBe(1500);
    expect(mirrorBudget(FREE_PLAN)).toBe(10);
  });

  it('MIRROR_BUDGET_PERCENT muda a parte da cota; o free continua em 10', () => {
    expect(mirrorBudget(PRO_PLAN, 35)).toBe(2625);
    expect(mirrorBudget(FREE_PLAN, 35)).toBe(10);
  });
});

describe('footballGroups', () => {
  it('temporada atual de cada competição, respeitando a cobertura, mais referência e estádios', async () => {
    const groups = await footballGroups(
      new StaticCatalogSource(fakeCatalog()),
      new InMemoryRawSource([]),
      PRO_PLAN,
      now,
      noDerbies,
    );
    const first = groups[0]!.candidates;
    const urls = first.map((c) => url(c.item));
    expect(urls).toContain('/standings?league=71&season=2026');
    expect(urls).toContain('/players/topscorers?league=71&season=2026');
    expect(urls).toContain('/fixtures/rounds?dates=true&league=71&season=2026');
    expect(urls).toContain('/teams?league=72&season=2026');
    expect(urls).toContain('/venues?country=Brazil');
    expect(urls).toContain('/odds/bookmakers?');
    // Libertadores sem lesões; Série B sem tabela e sem cartões
    expect(urls).not.toContain('/injuries?league=13&season=2026');
    expect(urls).not.toContain('/standings?league=72&season=2026');
    expect(urls).not.toContain('/players/topredcards?league=72&season=2026');
    // temporadas passadas ficam com as cargas manuais
    expect(urls.some((u) => u.includes('season=2025'))).toBe(false);
    // tier 1 todo dia, tier 2 a cada 2
    const period = (u: string) => first.find((c) => url(c.item) === u)!.periodDays;
    expect(period('/standings?league=71&season=2026')).toBe(1);
    expect(period('/teams?league=72&season=2026')).toBe(14);
  });
});

describe('rotateGroups', () => {
  const cand = (team: number, periodDays = 7): MirrorCandidate => ({
    item: plannedRequest('teams', 'football', '/teams', { id: team }),
    periodDays,
  });

  it('atende os grupos em ordem com o que sobra do orçamento; renovado hoje conta e não volta', async () => {
    const cursors = new InMemoryCursorStore();
    const a = [cand(1), cand(2), cand(3)];
    const b = [cand(4), cand(5)];
    await cursors.complete(a[0]!.item.cursors, {}, now); // hoje
    await cursors.complete(a[1]!.item.cursors, {}, new Date(now.getTime() - 2 * DAY)); // dentro do período
    const picked = await rotateGroups(
      [
        { name: 'a', candidates: a },
        { name: 'b', candidates: b },
      ],
      cursors,
      now,
      3,
    );
    // orçamento 3: 1 já renovado hoje, o 3 (nunca buscado) e o 4; o 2 está em dia
    expect(picked.map((p) => p.params.id)).toEqual(['3', '4']);
  });

  it('o vencido vai à rede: o raw mais velho que o corte não serve de cache (/teams: período e TTL de 7 dias)', async () => {
    const cursors = new InMemoryCursorStore();
    const a = [cand(1, 7)];
    // buscado há 7 dias, 1 min depois deste horário: vence hoje, e o raw (quase 7 dias) ainda estaria no TTL
    await cursors.complete(a[0]!.item.cursors, {}, new Date(now.getTime() - 7 * DAY + 60_000));
    const [picked] = await rotateGroups([{ name: 'a', candidates: a }], cursors, now, 10);
    expect(picked!.maxAgeMs).toBeLessThan(7 * DAY - 60_000);
  });

  it('o mais velho que o período volta à fila', async () => {
    const cursors = new InMemoryCursorStore();
    const a = [cand(1, 1), cand(2, 30)];
    await cursors.complete(a[0]!.item.cursors, {}, new Date(now.getTime() - 2 * DAY));
    await cursors.complete(a[1]!.item.cursors, {}, new Date(now.getTime() - 2 * DAY));
    const picked = await rotateGroups([{ name: 'a', candidates: a }], cursors, now, 10);
    expect(picked.map((p) => p.params.id)).toEqual(['1']);
  });

  it('período em dias UTC: o buscado ontem logo depois deste horário vence hoje no período de 1 dia', async () => {
    const cursors = new InMemoryCursorStore();
    const a = [cand(1, 1), cand(2, 7)];
    // ontem, 1 minuto depois do horário de agora (menos de 24 h atrás)
    const yesterday = new Date(now.getTime() - DAY + 60_000);
    await cursors.complete(a[0]!.item.cursors, {}, yesterday);
    await cursors.complete(a[1]!.item.cursors, {}, yesterday);
    const picked = await rotateGroups([{ name: 'a', candidates: a }], cursors, now, 10);
    expect(picked.map((p) => p.params.id)).toEqual(['1']);
  });

  it('o que falhou 3 vezes sem concluir sai da fila e não ocupa o orçamento', async () => {
    const cursors = new InMemoryCursorStore();
    const a = [cand(1), cand(2), cand(3)];
    const before = new Date(now.getTime() - 2 * DAY);
    for (let i = 0; i < 3; i++) await cursors.fail(a[0]!.item.cursors, 'erro do fornecedor', before);
    await cursors.fail(a[1]!.item.cursors, 'erro do fornecedor', before); // 1 falha: ainda tenta
    const picked = await rotateGroups([{ name: 'a', candidates: a }], cursors, now, 2);
    expect(picked.map((p) => p.params.id)).toEqual(['2', '3']);
  });

  it('o erro de hoje também conta no orçamento (reexecutar no mesmo dia não gasta de novo)', async () => {
    const cursors = new InMemoryCursorStore();
    const a = [cand(1), cand(2), cand(3)];
    await cursors.fail(a[0]!.item.cursors, 'erro do fornecedor', now);
    const picked = await rotateGroups([{ name: 'a', candidates: a }], cursors, now, 2);
    // orçamento 2: 1 já gasto hoje com erro; sobra 1 vaga (o 1, sem conclusão, é o mais velho)
    expect(picked).toHaveLength(1);
    // duas falhas hoje do mesmo pedido: as duas contam (o cursor guarda só a última data)
    await cursors.fail(a[0]!.item.cursors, 'erro do fornecedor', now);
    expect(await rotateGroups([{ name: 'a', candidates: a }], cursors, now, 2)).toEqual([]);
  });

  it('chamadas de hoje contadas por pedido feito, não pelos lotes remontados agora', async () => {
    const cursors = new InMemoryCursorStore();
    const ref = (id: number) => ({ sport: 'basketball', endpoint: '/x', key: `id=${id}` });
    // hoje: lote 1–10 (um pedido) e lote 11 (outro); o jogo 1 saiu da janela e o 2–11 virou um lote só
    await cursors.complete(
      Array.from({ length: 10 }, (_, i) => ref(i + 1)),
      { requestHash: 'h1', source: 'network' },
      now,
    );
    await cursors.complete([ref(11)], { requestHash: 'h2', source: 'network' }, now);
    const refs = Array.from({ length: 10 }, (_, i) => ref(i + 2));
    const regrouped: MirrorCandidate = {
      item: plannedRequest(
        'por-jogo',
        'basketball',
        '/x',
        { ids: refs.map((r) => r.key.slice(3)).join('-') },
        { cursors: refs },
      ),
      periodDays: 7,
    };
    const fresh = [cand(1), cand(2)];
    // orçamento 3: 2 pedidos de hoje (h1 e h2) gastos; sobra 1
    const picked = await rotateGroups([{ name: 'a', candidates: [regrouped, ...fresh] }], cursors, now, 3);
    expect(picked).toHaveLength(1);
    // resposta do cache não gasta cota
    const cached = new InMemoryCursorStore();
    await cached.complete([ref(1)], { requestHash: 'h3', source: 'cache' }, now);
    const one: MirrorCandidate = {
      item: plannedRequest('por-jogo', 'basketball', '/x', { ids: '1' }, { cursors: [ref(1)] }),
      periodDays: 7,
    };
    expect(await rotateGroups([{ name: 'a', candidates: [one, ...fresh] }], cached, now, 2)).toHaveLength(2);
  });

  it('lote de ids: o id esgotado sai do lote e o jogo novo ainda é buscado', async () => {
    const cursors = new InMemoryCursorStore();
    const refs = ['10', '11'].map((id) => ({ sport: 'basketball', endpoint: '/x', key: `id=${id}` }));
    const batch: MirrorCandidate = {
      item: plannedRequest('por-jogo', 'basketball', '/x', { ids: '10-11' }, { cursors: refs }),
      periodDays: 1,
    };
    for (let i = 0; i < 3; i++) await cursors.fail([refs[0]!], 'erro', new Date(now.getTime() - 2 * DAY));
    const picked = await rotateGroups([{ name: 'a', candidates: [batch] }], cursors, now, 5);
    expect(picked.map((p) => p.params.ids)).toEqual(['11']);
    expect(picked[0]!.cursors.map((c) => c.key)).toEqual(['id=11']);
    // todos esgotados: o lote sai inteiro
    for (let i = 0; i < 3; i++) await cursors.fail([refs[1]!], 'erro', new Date(now.getTime() - 2 * DAY));
    expect(await rotateGroups([{ name: 'a', candidates: [batch] }], cursors, now, 5)).toEqual([]);
  });

  it('--forcar renova o que está em dia, dentro do orçamento', async () => {
    const cursors = new InMemoryCursorStore();
    const a = [cand(1), cand(2), cand(3)];
    await cursors.complete(a[0]!.item.cursors, {}, now);
    await cursors.complete(a[1]!.item.cursors, {}, new Date(now.getTime() - 2 * DAY));
    const normal = await rotateGroups([{ name: 'a', candidates: a }], cursors, now, 2);
    expect(normal.map((p) => p.params.id)).toEqual(['3']);
    const forced = await rotateGroups([{ name: 'a', candidates: a }], cursors, now, 2, { force: true });
    expect(forced.map((p) => p.params.id)).toEqual(['3', '2']);
    // e sem o cache do raw
    expect(forced.every((p) => p.maxAgeMs === 0)).toBe(true);
    // sem --forcar, o cache vale até o corte do período (o raw de antes dele vai à rede)
    expect(normal.every((p) => (p.maxAgeMs ?? 0) > 0)).toBe(true);
  });
});

function fakeSports(): SportMirrorSource {
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
  return {
    seasons: async () => [
      {
        league: '12',
        tier: 1,
        year: 2026,
        key: '2026-2027',
        current: true,
        startDate: '2026-10-01',
        endDate: '2027-06-30',
      },
      {
        league: '12',
        tier: 1,
        year: 2025,
        key: '2025-2026',
        current: false,
        startDate: '2025-10-01',
        endDate: '2026-06-30',
      },
      { league: '99', tier: 3, year: 2026, key: '2026-2027', current: true, startDate: null, endDate: null },
    ],
    games: async () => [
      ...Array.from({ length: 12 }, (_, i) => ({
        id: String(100 + i),
        league: '12',
        year: 2026,
        tier: 1,
        status: 'finished',
        startsAt: at(-20 - i),
      })),
      { id: '200', league: '12', year: 2026, tier: 1, status: 'scheduled', startsAt: at(10) },
    ],
    teams: async () => ['1', '2'],
    participants: async () => [],
  };
}

describe('sportGroups', () => {
  it('basquete: temporada, tabela, times, estatística por jogo em lote, odds e elenco', async () => {
    const groups = await sportGroups('basketball', fakeSports(), ULTRA_PLAN, now);
    const urls = groups.flatMap((g) => g.candidates.map((c) => url(c.item)));
    expect(urls).toContain('/games?league=12&season=2026-2027');
    expect(urls).toContain('/standings?league=12&season=2026-2027');
    expect(urls).toContain('/teams?league=12&season=2026-2027');
    expect(urls).toContain('/statistics?league=12&season=2026-2027&team=1');
    expect(urls).toContain('/players?season=2026-2027&team=2');
    expect(urls).toContain('/odds?game=200');
    expect(urls).toContain('/bookmakers?');
    // tier 3 fora (padrão 2) e temporada passada fora
    expect(urls.some((u) => u.includes('league=99') || u.includes('2025-2026'))).toBe(false);
    // 12 jogos em lotes de 10: 2 chamadas por endpoint, um cursor por jogo
    const batches = groups[1]!.candidates.filter((c) => c.item.endpoint === '/games/statistics/teams');
    expect(batches).toHaveLength(2);
    expect(batches[0]!.item.cursors).toHaveLength(10);
  });

  it('F1: sessão encerrada recebe resultado, grid, voltas e pit stops; rankings da temporada', async () => {
    const groups = await sportGroups('formula-1', fakeSports(), ULTRA_PLAN, now);
    const urls = groups.flatMap((g) => g.candidates.map((c) => url(c.item)));
    expect(urls).toContain('/races?season=2026-2027');
    expect(urls).toContain('/rankings/drivers?season=2026-2027');
    expect(urls).toContain('/pitstops?race=100');
    expect(urls).toContain('/rankings/fastestlaps?race=111');
    // o grid já vem em `grid` no /rankings/races: não gasta cota
    expect(urls.some((u) => u.startsWith('/rankings/startinggrid'))).toBe(false);
  });

  it('F1: pit stop só em corrida e sprint (sessão sem tipo conhecido ainda pede)', async () => {
    const base = fakeSports();
    const source = {
      ...base,
      games: async (...args: Parameters<SportMirrorSource['games']>) =>
        (await base.games(...args)).map((g, i) => ({
          ...g,
          session: ['Race', '1st Practice', 'Sprint', '2nd Qualifying'][i] ?? null,
        })),
    };
    const urls = (await sportGroups('formula-1', source, ULTRA_PLAN, now)).flatMap((g) =>
      g.candidates.map((c) => url(c.item)),
    );
    expect(urls).toContain('/pitstops?race=100');
    expect(urls).not.toContain('/pitstops?race=101');
    expect(urls).toContain('/pitstops?race=102');
    expect(urls).not.toContain('/pitstops?race=103');
    expect(urls).toContain('/pitstops?race=104');
    // resultado vale para toda sessão
    expect(urls).toContain('/rankings/races?race=101');
  });

  it('basquete: o que o coverage da temporada marca como false não gasta chamada', async () => {
    const base = fakeSports();
    const source = {
      ...base,
      seasons: async () =>
        (await base.seasons('basketball')).map((s) => ({
          ...s,
          coverage: {
            standings: false,
            players: false,
            odds: true,
            games: { statistics: { teams: true, players: false } },
          },
        })),
    };
    const urls = (await sportGroups('basketball', source, ULTRA_PLAN, now)).flatMap((g) =>
      g.candidates.map((c) => url(c.item)),
    );
    expect(urls.some((u) => u.startsWith('/standings?'))).toBe(false);
    expect(urls.some((u) => u.startsWith('/players?'))).toBe(false);
    expect(urls.some((u) => u.startsWith('/games/statistics/players'))).toBe(false);
    expect(urls.some((u) => u.startsWith('/games/statistics/teams'))).toBe(true);
    expect(urls).toContain('/statistics?league=12&season=2026-2027&team=1');
    expect(urls).toContain('/odds?game=200');
  });

  it('free: a temporada atual e os jogos dela ficam fora; só a referência', async () => {
    const groups = await sportGroups('hockey', fakeSports(), FREE_PLAN, now);
    const urls = groups.flatMap((g) => g.candidates.map((c) => url(c.item)));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.endsWith('?'))).toBe(true);
  });

  it('MMA free: lutador só de jogo de temporada que o plano alcança', async () => {
    const asked: (readonly number[])[] = [];
    const source = {
      ...fakeSports(),
      participants: async (_s: string, _f: Date, _t: Date, years: readonly number[]) => {
        asked.push(years);
        return years.length ? ['7'] : [];
      },
    };
    const free = await sportGroups('mma', source, FREE_PLAN, now);
    const freeUrls = free.flatMap((g) => g.candidates.map((c) => url(c.item)));
    expect(freeUrls.some((u) => u.startsWith('/fighters'))).toBe(false);
    expect(asked[0]).toEqual([]);
    const ultra = await sportGroups('mma', source, ULTRA_PLAN, now);
    expect(ultra.flatMap((g) => g.candidates.map((c) => url(c.item)))).toContain('/fighters?id=7');
    expect(asked.at(-1)).toEqual([2026]);
  });
});

describe('mirrorJobs', () => {
  const deps = (cursors = new InMemoryCursorStore()) => ({
    catalog: new StaticCatalogSource(fakeCatalog()),
    raw: new InMemoryRawSource([]),
    cursors,
    planFor: (sport: string) => new PlanRules(sport === 'football' ? PRO_PLAN : FREE_PLAN),
    now: () => now,
    derbyPairs: noDerbies,
    sports: fakeSports(),
  });

  it('uma execução por API, cada uma com o orçamento e o plano dela', async () => {
    const jobs = mirrorJobs(deps(), { sports: ['football', 'volleyball'] });
    // execuções separadas: a cota esgotada (ou um 429) do futebol não para o vôlei
    expect(jobs.map((j) => j.sport)).toEqual(['football', 'volleyball']);
    for (const { spec } of jobs) {
      expect(spec.job).toBe('sync:mirror');
      expect(spec.priority).toBe('DAILY');
      expect(spec.phases).toHaveLength(1);
    }
    const football = await jobs[0]!.spec.phases[0]!.build();
    expect(football.some((i) => i.endpoint === '/standings')).toBe(true);
    const volley = await jobs[1]!.spec.phases[0]!.build();
    expect(volley.length).toBeLessThanOrEqual(10);
    expect(volley.every((i) => Object.keys(i.params).length === 0)).toBe(true);
  });

  it('dado por jogo encerrado: renovado no máximo uma vez por dia dentro da janela de 3 dias', async () => {
    const groups = await sportGroups('hockey', fakeSports(), ULTRA_PLAN, now);
    const perGame = groups[1]!.candidates.filter((c) => c.item.endpoint === '/games/events');
    expect(perGame.length).toBeGreaterThan(0);
    expect(perGame.every((c) => c.periodDays === 1)).toBe(true);
  });
});

const cfgOf = (env: Record<string, string>) => mirrorConfig((k) => env[k], { strict: true });

describe('configuração do painel (Ajustes → Operação → Espelho)', () => {
  it('cada candidato do futebol aponta para um item do catálogo, com a coluna do tier', async () => {
    const groups = await footballGroups(
      new StaticCatalogSource(fakeCatalog()),
      new InMemoryRawSource([]),
      PRO_PLAN,
      now,
      async () => ['1-2'],
    );
    const ids = new Set(MIRROR_CATALOG.football!.map((d) => d.id));
    for (const c of groups.flatMap((g) => g.candidates)) {
      expect(c.slot, url(c.item)).toBeDefined();
      expect(ids.has(c.slot!.id), c.slot!.id).toBe(true);
    }
    expect(groups.map((g) => g.id)).toEqual([
      'temporada',
      'palpites-odds',
      'estatisticas',
      'tier3',
      'elencos',
    ]);
  });

  it('período e endpoint desligado vêm do painel', async () => {
    const mirror = cfgOf({ MIRROR_PERIODS_FOOTBALL: '/standings=3,off,8; /venues=off' }).api('football');
    const groups = await footballGroups(
      new StaticCatalogSource(fakeCatalog()),
      new InMemoryRawSource([]),
      PRO_PLAN,
      now,
      noDerbies,
      { mirror },
    );
    const first = groups[0]!.candidates;
    const period = (u: string) => first.find((c) => url(c.item) === u)?.periodDays;
    expect(period('/standings?league=71&season=2026')).toBe(3);
    expect(first.filter((c) => c.item.endpoint === '/venues').every((c) => c.periodDays === null)).toBe(true);
    // desligado não entra no rodízio, mas continua contado no inventário
    const picked = await rotateGroups(
      arrangeGroups(groups, mirror.groupOrder),
      new InMemoryCursorStore(),
      now,
      1000,
    );
    expect(picked.some((p) => p.endpoint === '/venues')).toBe(false);
  });

  it('desligar e reexecutar no mesmo dia não libera de novo a cota que o item já gastou', async () => {
    const venue = (country: string, periodDays: number | null): MirrorCandidate => ({
      item: plannedRequest('venues', 'football', '/venues', { country }),
      periodDays,
    });
    const cursors = new InMemoryCursorStore();
    // primeira execução de hoje: 2 chamadas no /venues
    const first = [venue('Brazil', 30), venue('Chile', 30)];
    await cursors.complete(first[0]!.item.cursors, { requestHash: 'a' }, now);
    await cursors.complete(first[1]!.item.cursors, { requestHash: 'b' }, now);
    // /venues desligado no painel; o orçamento de 3 só tem 1 vaga
    const groups = [
      { id: 'temporada' as const, name: 'a', candidates: [venue('Brazil', null), venue('Chile', null)] },
      { id: 'elencos' as const, name: 'b', candidates: [venue('Peru', 30), venue('Uruguay', 30)] },
    ];
    const picked = await rotateGroups(arrangeGroups(groups, ['temporada', 'elencos']), cursors, now, 3);
    expect(picked.map((p) => p.params.country)).toEqual(['Peru']);
  });

  it('ordem dos grupos: o primeiro da lista recebe o orçamento antes', async () => {
    const sports = await sportGroups('basketball', fakeSports(), ULTRA_PLAN, now);
    const order = cfgOf({ MIRROR_GROUP_ORDER_SPORTS: 'por-time,por-jogo,temporada' }).api(
      'basketball',
    ).groupOrder;
    const arranged = arrangeGroups(sports, order);
    expect(arranged.map((g) => g.id)).toEqual(['por-time', 'por-jogo', 'temporada']);
    const picked = await rotateGroups(arranged, new InMemoryCursorStore(), now, 2);
    expect(picked).toHaveLength(2);
    expect(picked.every((p) => ['estatisticas-time', 'elenco'].includes(p.step))).toBe(true);
  });

  it('o job grava o inventário (com os desligados) e usa o orçamento do painel', async () => {
    const cursors = new InMemoryCursorStore();
    const env = { MIRROR_PERIODS_BASKETBALL: '/games=off', MIRROR_BUDGET_PERCENT: '1' };
    const jobs = mirrorJobs(
      {
        catalog: new StaticCatalogSource(fakeCatalog()),
        raw: new InMemoryRawSource([]),
        cursors,
        planFor: () => new PlanRules(ULTRA_PLAN),
        now: () => now,
        derbyPairs: noDerbies,
        sports: fakeSports(),
      },
      { sports: ['basketball'], mirror: cfgOf(env) },
    );
    const items = await jobs[0]!.spec.phases[0]!.build();
    expect(items.some((i) => i.endpoint === '/games')).toBe(false);
    // 1% de 75.000
    expect(items.length).toBeLessThanOrEqual(750);
    const [row] = (await cursors.load([{ sport: 'basketball', ...MIRROR_INVENTORY_CURSOR }])).values();
    const inv = parseMirrorInventory(row?.cursor);
    expect(inv?.at).toBe(now.toISOString());
    // uma temporada tier 1 no plano: a lista da temporada segue contada na coluna do tier 1
    expect(inv?.items['/games']).toEqual([1]);
    expect(inv?.items['/statistics']).toEqual([2]);
    expect(inv?.items['/games/statistics/teams']).toEqual([2]);
  });

  it('execução com tier fora do padrão (manual) não sobrescreve o inventário do painel', async () => {
    const cursors = new InMemoryCursorStore();
    const jobs = mirrorJobs(
      {
        catalog: new StaticCatalogSource(fakeCatalog()),
        raw: new InMemoryRawSource([]),
        cursors,
        planFor: () => new PlanRules(ULTRA_PLAN),
        now: () => now,
        derbyPairs: noDerbies,
        sports: fakeSports(),
      },
      { sports: ['basketball'], other: { maxTier: 3 } },
    );
    await jobs[0]!.spec.phases[0]!.build();
    expect((await cursors.load([{ sport: 'basketball', ...MIRROR_INVENTORY_CURSOR }])).size).toBe(0);
  });
});

/** Ids que o perfil de uma API pode gerar (a mesma regra de sportGroups). */
function profileIds(sport: OtherSport): string[] {
  const p = SPORT_MIRROR[sport];
  return [
    ...p.reference,
    p.seasonList('L', 'S').endpoint,
    ...p.standings('L', 'S').map((s) => s.endpoint),
    ...(p.seasonTeams ? ['/teams'] : []),
    ...(p.teamStats ? [p.teamStats('L', 'S', 'T').endpoint] : []),
    ...(p.roster?.('S', 'T') ?? []).map((r) => r.endpoint),
    ...(p.injuries ? ['/injuries'] : []),
    ...(p.finished ?? []).map((f) => f.id ?? f.endpoint),
    ...(p.odds ? [p.odds] : []),
    ...(p.participants ?? []).map((pc) => pc.endpoint),
  ];
}

describe('catálogo do espelho × perfis das APIs', () => {
  it('os itens de cada uma das 11 APIs são os que o perfil gera', () => {
    for (const sport of Object.keys(SPORT_MIRROR) as OtherSport[])
      expect(new Set(profileIds(sport)), sport).toEqual(new Set(MIRROR_CATALOG[sport]!.map((d) => d.id)));
  });

  it('todos os candidatos das 11 APIs têm item no catálogo', async () => {
    for (const sport of Object.keys(SPORT_MIRROR) as OtherSport[]) {
      const groups = await sportGroups(sport, fakeSports(), ULTRA_PLAN, now);
      for (const c of groups.flatMap((g) => g.candidates))
        expect(c.slot, `${sport} ${c.item.endpoint}`).toBeDefined();
    }
  });
});
