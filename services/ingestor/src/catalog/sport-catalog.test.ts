import { describe, expect, it } from 'vitest';
import { BASKETBALL_CATALOG, BASKETBALL_COUNTRIES, BASKETBALL_LEAGUES } from '../../test/fixtures.js';
import {
  checkSportCatalog,
  estimateSeasonCalls,
  F1_CHAMPIONSHIP_ID,
  MMA_ALL_FIGHTS_ID,
  OTHER_SPORTS,
  parseLeagues,
  planSeasonCalls,
  SPORT_PROFILES,
  sportCountryCode,
} from './sport-catalog.js';

const TODAY = new Date('2026-10-21T12:00:00Z');
describe('países', () => {
  it('normaliza códigos em branco e regiões com código', () => {
    expect(sportCountryCode({ name: 'World', code: ' ' })).toBe('WORLD');
    expect(sportCountryCode({ name: 'Asia', code: 'AS' })).toBe('ASIA');
    expect(sportCountryCode({ name: 'South-America', code: null })).toBe('SOUTH-AMERICA');
    expect(sportCountryCode({ name: 'Dominican-Republic', code: 'do' })).toBe('DO');
  });
});

describe('parseLeagues', () => {
  it('aceita o formato da NFL (igual ao futebol)', () => {
    const [nfl] = parseLeagues([
      {
        league: { id: 1, name: 'NFL', logo: 'https://media.api-sports.io/american-football/leagues/1.png' },
        country: { name: 'USA', code: 'US', flag: 'https://media.api-sports.io/flags/us.svg' },
        seasons: [{ year: 2024, start: '2024-08-02', end: '2025-02-09', current: false, coverage: null }],
      },
    ]);
    expect(nfl).toMatchObject({ id: '1', name: 'NFL', type: 'league', country: { code: 'US' } });
    expect(nfl!.seasons[0]).toMatchObject({ key: '2024', year: 2024, current: false });
  });

  it('agrupa a AFL, que vem com uma linha por temporada', () => {
    const rows = [2023, 2024, 2025].map((season) => ({
      id: 1,
      name: 'AFL Premiership',
      logo: 'https://media.api-sports.io/afl/leagues/1.png',
      season,
      start: `${season}-03-15`,
      end: `${season}-09-28`,
      current: season === 2025,
    }));
    const leagues = parseLeagues(rows);
    expect(leagues).toHaveLength(1);
    expect(leagues[0]!.seasons.map((s) => s.year)).toEqual([2023, 2024, 2025]);
    expect(leagues[0]!.country).toBeNull();
  });

  it('ignora lixo', () => {
    expect(parseLeagues(null)).toEqual([]);
    expect(parseLeagues([null, 'x', { name: 'sem id' }])).toEqual([]);
  });
});

describe('perfis por esporte', () => {
  it('cobre as 11 APIs e só exige endpoints que busca', () => {
    expect(Object.keys(SPORT_PROFILES).sort()).toEqual([...OTHER_SPORTS].sort());
    for (const p of Object.values(SPORT_PROFILES)) {
      for (const e of p.required) expect(p.reference).toContain(e);
    }
    expect(SPORT_PROFILES.basketball.reference).toContain('/bookmakers');
    expect(SPORT_PROFILES.volleyball.reference).toContain('/odds/bookmakers');
  });

  it('basquete: temporadas "2024-2025", tier/slug/labels do YAML e país das regiões', () => {
    const rows = SPORT_PROFILES.basketball.build(
      new Map<string, unknown>([
        ['/countries', BASKETBALL_COUNTRIES],
        ['/leagues', BASKETBALL_LEAGUES],
      ]),
      { catalog: BASKETBALL_CATALOG, today: TODAY },
    );
    const nbb = rows.competitions.find((c) => c.providerId === '26')!;
    expect(nbb).toMatchObject({
      slug: 'nbb',
      tier: 1,
      livePriority: 'high',
      countryCode: 'BR',
      type: 'league',
    });
    expect(nbb.labels).toEqual({ 'pt-BR': 'NBB (Novo Basquete Brasil)' });
    expect(nbb.seasons.map((s) => [s.year, s.label, s.providerKey, s.current])).toEqual([
      [2022, '2022/23', '2022-2023', false],
      [2024, '2024/25', '2024-2025', false],
      [2026, '2026/27', '2026-2027', true], // sem `current` no fornecedor: dentro do período
    ]);
    const anon = rows.competitions.find((c) => c.providerId === '414')!;
    expect(anon).toMatchObject({
      slug: 'south-america-south-american-league-414',
      tier: 3,
      countryCode: 'SOUTH-AMERICA',
    });
    expect(rows.countries.map((c) => c.code).sort()).toEqual(['ASIA', 'BR', 'SOUTH-AMERICA', 'WORLD']);
    expect(rows.countries.find((c) => c.code === 'WORLD')?.flagUrl).toBeNull();

    const check = checkSportCatalog(BASKETBALL_CATALOG, rows);
    expect(check.map((c) => c.status)).toEqual(['ok', 'ok', 'missing', 'unverified']);
    expect(check[0]!.currentSeason).toBe(2026);
  });

  it('AFL sem país usa Austrália', () => {
    const rows = SPORT_PROFILES.afl.build(
      new Map([
        [
          '/leagues',
          [
            {
              id: 1,
              name: 'AFL Premiership',
              logo: null,
              season: 2024,
              start: null,
              end: null,
              current: true,
            },
          ],
        ],
      ]),
      { catalog: [], today: TODAY },
    );
    expect(rows.competitions[0]).toMatchObject({ countryCode: 'AU', slug: 'australia-afl-premiership-1' });
    expect(rows.countries).toEqual([
      { code: 'AU', name: { en: 'Australia' }, flagUrl: 'https://media.api-sports.io/flags/au.svg' },
    ]);
  });

  it('F1: campeonato sintético, construtores e circuitos com imagem', () => {
    const rows = SPORT_PROFILES['formula-1'].build(
      new Map<string, unknown>([
        ['/seasons', [2023, 2024, 2025]],
        [
          '/teams',
          [{ id: 1, name: 'Red Bull Racing', logo: 'https://media.api-sports.io/formula-1/teams/1.png' }],
        ],
        [
          '/circuits',
          [
            {
              id: 16,
              name: 'Autodromo Nazionale Monza',
              image: 'https://media.api-sports.io/formula-1/circuits/16.png',
              competition: {
                id: 16,
                name: 'Italy Grand Prix',
                location: { country: 'Italy', city: 'Monza' },
              },
              capacity: 113860,
            },
          ],
        ],
      ]),
      {
        catalog: [
          {
            slug: 'formula-1-world-championship',
            name: 'Formula 1 World Championship',
            country: 'World',
            type: 'league',
            api_sports_id: F1_CHAMPIONSHIP_ID,
            tier: 1,
            live_priority: 'high',
          },
        ],
        today: TODAY,
      },
    );
    expect(rows.competitions).toHaveLength(1);
    expect(rows.competitions[0]).toMatchObject({
      providerId: F1_CHAMPIONSHIP_ID,
      tier: 1,
      countryCode: 'WORLD',
    });
    expect(rows.competitions[0]!.seasons.map((s) => [s.label, s.current])).toEqual([
      ['2023', false],
      ['2024', false],
      ['2025', true],
    ]);
    expect(rows.participants).toEqual([
      expect.objectContaining({
        providerId: '1',
        kind: 'constructor',
        logoUrl: 'https://media.api-sports.io/formula-1/teams/1.png',
      }),
    ]);
    expect(rows.venues).toEqual([
      expect.objectContaining({ providerId: '16', city: 'Monza', countryName: 'Italy', capacity: 113860 }),
    ]);
    const games = planSeasonCalls(SPORT_PROFILES['formula-1'], rows, {
      seasonWindow: { min: 2022, max: 2024 },
    });
    expect(games.map((g) => [g.endpoint, g.params])).toEqual([
      ['/races', { season: '2023' }],
      ['/races', { season: '2024' }],
    ]);
    // `--temporada 2024`: só a mais recente da janela, com as tabelas logo depois
    const latest = planSeasonCalls(SPORT_PROFILES['formula-1'], rows, {
      seasonWindow: { min: 2022, max: 2024 },
      seasons: [2024],
      standings: true,
    });
    expect(latest.map((g) => [g.kind, g.endpoint, g.params])).toEqual([
      ['season', '/races', { season: '2024' }],
      ['standings', '/rankings/drivers', { season: '2024' }],
      ['standings', '/rankings/teams', { season: '2024' }],
    ]);
  });

  it('F1: resultado de cada sessão encerrada, corrida e sprint antes de classificação e treinos', () => {
    const now = new Date('2026-10-23T00:00:00Z');
    const session = (id: number, type: string, date: string, status = 'Completed') => ({
      id,
      type,
      date,
      status,
    });
    const calls = SPORT_PROFILES['formula-1'].detailCalls!(
      [
        session(1, '1st Practice', '2024-03-01T11:30:00+00:00'),
        session(2, '3rd Qualifying', '2024-03-01T16:48:00+00:00'),
        session(3, '1st Qualifying', '2024-03-01T16:00:00+00:00'),
        session(4, 'Race', '2024-03-02T15:00:00+00:00'),
        session(5, 'Sprint', '2024-04-20T03:30:00+00:00'),
        session(6, 'Race', '2026-10-20T15:00:00+00:00'),
        session(7, 'Race', '2026-10-25T15:00:00+00:00', 'Scheduled'),
        session(8, '1st Sprint Shootout', '2024-04-19T10:30:00+00:00'),
      ],
      now,
    );
    expect(calls.map((c) => c.params.race)).toEqual(['4', '6', '5', '2', '3', '8', '1']);
    expect(calls.every((c) => c.endpoint === '/rankings/races')).toBe(true);
    // sessão de dias atrás não muda mais; a de 3 dias atrás ainda pode ter punição
    expect(calls.find((c) => c.params.race === '4')!.final).toBe(true);
    expect(calls.find((c) => c.params.race === '6')!.final).toBe(false);
    expect(SPORT_PROFILES['formula-1'].detailCalls!(null, now)).toEqual([]);
  });

  it('MMA: competição sintética com lutas por temporada', () => {
    const rows = SPORT_PROFILES.mma.build(new Map([['/seasons', [2022, 2023, 2024, 2025, 2026]]]), {
      catalog: [],
      today: TODAY,
    });
    expect(rows.competitions[0]).toMatchObject({ providerId: MMA_ALL_FIGHTS_ID, tier: 3, type: 'cup' });
    const games = planSeasonCalls(SPORT_PROFILES.mma, rows, { maxTier: 3, latestSeasons: 2 });
    expect(games.map((g) => g.params)).toEqual([{ season: '2025' }, { season: '2026' }]);
  });

  it('NBA: ligas em texto, temporadas split-year e logos da Wikimedia fora do Asset Mirror', () => {
    const rows = SPORT_PROFILES.nba.build(
      new Map<string, unknown>([
        ['/seasons', [2023, 2024]],
        ['/leagues', ['standard', 'vegas']],
        [
          '/teams',
          [
            {
              id: 1,
              name: 'Atlanta Hawks',
              nickname: 'Hawks',
              code: 'ATL',
              logo: 'https://upload.wikimedia.org/hawks.png',
            },
          ],
        ],
      ]),
      {
        catalog: [
          {
            slug: 'nba',
            name: 'NBA',
            country: 'USA',
            type: 'league',
            api_sports_id: 'standard',
            tier: 1,
            seasons_strategy: 'split-year',
          },
        ],
        today: TODAY,
      },
    );
    expect(rows.competitions.map((c) => [c.providerId, c.slug, c.name, c.tier])).toEqual([
      ['standard', 'nba', 'NBA', 1],
      ['vegas', 'usa-nba-vegas-vegas', 'NBA vegas', 3],
    ]);
    expect(rows.competitions[0]!.seasons.map((s) => s.label)).toEqual(['2023/24', '2024/25']);
    expect(rows.participants![0]).toMatchObject({ name: 'Atlanta Hawks', code: 'ATL', logoUrl: null });
    const games = planSeasonCalls(SPORT_PROFILES.nba, rows, { seasonWindow: { min: 2022, max: 2024 } });
    expect(games.map((g) => g.params)).toEqual([
      { league: 'standard', season: '2023' },
      { league: 'standard', season: '2024' },
    ]);
  });
});

describe('temporadas inteiras (--jogos)', () => {
  const rows = SPORT_PROFILES.basketball.build(
    new Map<string, unknown>([
      ['/countries', BASKETBALL_COUNTRIES],
      ['/leagues', BASKETBALL_LEAGUES],
    ]),
    { catalog: BASKETBALL_CATALOG, today: TODAY },
  );

  it('respeita a janela do plano e o tier, com a chave de temporada do fornecedor', () => {
    const calls = planSeasonCalls(SPORT_PROFILES.basketball, rows, {
      seasonWindow: { min: 2022, max: 2024 },
    });
    expect(calls.map((c) => [c.competition, c.endpoint, c.params])).toEqual([
      ['nbb', '/games', { league: '26', season: '2022-2023' }],
      ['nbb', '/games', { league: '26', season: '2024-2025' }],
      ['olympics-basketball', '/games', { league: '192', season: '2024' }],
    ]);
  });

  it('latestSeasons dentro da janela traz só a temporada mais recente permitida', () => {
    const calls = planSeasonCalls(SPORT_PROFILES.basketball, rows, {
      seasonWindow: { min: 2022, max: 2024 },
      latestSeasons: 1,
    });
    expect(calls.map((c) => [c.competition, c.params])).toEqual([
      ['nbb', { league: '26', season: '2024-2025' }],
      ['olympics-basketball', { league: '192', season: '2024' }],
    ]);
    const estimated = estimateSeasonCalls(SPORT_PROFILES.basketball, BASKETBALL_CATALOG, {
      seasonWindow: { min: 2022, max: 2024 },
      latestSeasons: 1,
      currentYear: 2026,
    });
    expect(estimated.map((c) => c.season)).toEqual([2024, 2024]);
  });

  it('com standings, a classificação de cada temporada vem logo depois dos jogos', () => {
    const calls = planSeasonCalls(SPORT_PROFILES.basketball, rows, {
      seasonWindow: { min: 2024, max: 2024 },
      standings: true,
    });
    expect(calls.map((c) => [c.competition, c.endpoint, c.params])).toEqual([
      ['nbb', '/games', { league: '26', season: '2024-2025' }],
      ['nbb', '/standings', { league: '26', season: '2024-2025' }],
      ['olympics-basketball', '/games', { league: '192', season: '2024' }],
      ['olympics-basketball', '/standings', { league: '192', season: '2024' }],
    ]);
    const estimated = estimateSeasonCalls(SPORT_PROFILES.basketball, BASKETBALL_CATALOG, {
      seasonWindow: { min: 2024, max: 2024 },
      currentYear: 2026,
      standings: true,
    });
    expect(estimated.map((c) => c.endpoint)).toEqual(['/games', '/standings', '/games', '/standings']);
  });

  it('F1 busca os dois rankings da temporada; MMA não tem classificação', () => {
    const f1 = SPORT_PROFILES['formula-1'].build(new Map([['/seasons', [2024]]]), {
      catalog: [],
      today: TODAY,
    });
    expect(
      planSeasonCalls(SPORT_PROFILES['formula-1'], f1, { maxTier: 3, latestSeasons: 1, standings: true }).map(
        (c) => [c.endpoint, c.params],
      ),
    ).toEqual([
      ['/races', { season: '2024' }],
      ['/rankings/drivers', { season: '2024' }],
      ['/rankings/teams', { season: '2024' }],
    ]);
    const mma = SPORT_PROFILES.mma.build(new Map([['/seasons', [2024]]]), { catalog: [], today: TODAY });
    expect(
      planSeasonCalls(SPORT_PROFILES.mma, mma, { maxTier: 3, latestSeasons: 1, standings: true }).map(
        (c) => c.endpoint,
      ),
    ).toEqual(['/fights']);
  });

  it('sem janela (plano pago) usa as temporadas mais recentes', () => {
    const calls = planSeasonCalls(SPORT_PROFILES.basketball, rows, { latestSeasons: 1, maxTier: 3 });
    expect(calls.map((c) => c.params)).toEqual([
      { league: '26', season: '2026-2027' },
      { league: '192', season: '2024' },
      { league: '414', season: '2023' },
    ]);
  });

  it('estima pelo YAML quando ainda não há /leagues no raw', () => {
    const calls = estimateSeasonCalls(SPORT_PROFILES.basketball, BASKETBALL_CATALOG, {
      seasonWindow: { min: 2023, max: 2024 },
      currentYear: 2026,
    });
    expect(calls.map((c) => c.params)).toEqual([
      { league: '26', season: '2023-2024' },
      { league: '26', season: '2024-2025' },
      { league: '192', season: '2023' },
      { league: '192', season: '2024' },
    ]);
  });
});
