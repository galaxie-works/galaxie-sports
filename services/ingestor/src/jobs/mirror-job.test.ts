import { FREE_PLAN, PlanRules, PRO_PLAN, ULTRA_PLAN } from '@galaxie/apisports-client';
import { describe, expect, it } from 'vitest';
import { fakeCatalog, NOW } from '../testing/fake-api.js';
import { StaticCatalogSource } from './catalog-source.js';
import {
  footballGroups,
  inPlay,
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
    for (let i = 0; i < 3; i++) await cursors.fail(a[0]!.item.cursors, 'erro do fornecedor', now);
    await cursors.fail(a[1]!.item.cursors, 'erro do fornecedor', now); // 1 falha: ainda tenta
    const picked = await rotateGroups([{ name: 'a', candidates: a }], cursors, now, 2);
    expect(picked.map((p) => p.params.id)).toEqual(['2', '3']);
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
