import { describe, expect, it } from 'vitest';
import { loadSportFixture } from '../../../test/load-fixture.js';
import { EXPECTED_DURATION_MIN } from '../../event/status.js';
import type { NormalizedEvent } from '../../model.js';
import {
  f1SessionMinutes,
  mmaCategoryStage,
  nbaStage,
  nflStage,
  NORMALIZABLE_SPORT_ENDPOINTS,
  normalizeF1RaceRanking,
  normalizeF1Races,
  normalizeF1Standings,
  normalizeMmaFights,
  normalizeMmaResults,
  normalizeSportEnvelope,
  normalizeSportGames,
  normalizeSportStandings,
  normalizeSportTeams,
  roundStage,
  seasonYear,
} from './normalize.js';
import { API_SPORTS_OTHER_SPORTS, type ApiSportsOtherSport } from './status.js';

const FETCHED = new Date('2026-10-21T14:13:54Z');
const MIN = 60_000;

function games(sport: ApiSportsOtherSport, file: string) {
  const env = loadSportFixture(sport, file);
  return normalizeSportGames(sport, env.response, FETCHED);
}
const byId = (events: NormalizedEvent[], id: string) => events.find((e) => e.id === id)!;
const duration = (e: NormalizedEvent) =>
  (e.observation.endsAtExpected.getTime() - e.observation.startsAt.getTime()) / MIN;

describe('jogos dos esportes coletivos (respostas reais recortadas)', () => {
  it('basquete: temporada "2024-2025", quartos, prorrogação, cancelado e fase de mata-mata', () => {
    const b = games('basketball', 'games-12-2024-2025.json');
    expect(b).toMatchObject({ provider: 'api-sports', sport: 'basketball', observedAt: FETCHED });
    expect(b.competitions).toEqual([
      {
        id: '12',
        name: 'NBA',
        type: 'league',
        countryName: 'USA',
        countryCode: 'US',
        logoUrl: 'https://media.api-sports.io/basketball/leagues/12.png',
        seasons: [{ year: 2024, label: '2024/25', startDate: null, endDate: null }],
      },
    ]);
    const ft = byId(b.events, '425068');
    expect(ft.season).toEqual({ competitionId: '12', year: 2024 });
    expect(ft.observation).toMatchObject({ status: 'finished', statusDetail: 'FT' });
    expect(ft.observation.score).toEqual({
      home: 103,
      away: 107,
      periods: {
        q1: { home: 32, away: 25 },
        q2: { home: 31, away: 31 },
        q3: { home: 17, away: 23 },
        q4: { home: 23, away: 28 },
      },
    });
    expect(ft.participants).toEqual([
      { participantId: '139', side: 'home', position: null, result: { score: 103, winner: false } },
      { participantId: '133', side: 'away', position: null, result: { score: 107, winner: true } },
    ]);
    expect(duration(ft)).toBe(135);
    expect(ft.sportEvent).toMatchObject({ providerEventId: '425068', kind: 'game', detail: null });
    expect(ft.sportEvent!.summary).toMatchObject({ id: 425068, venue: 'TD Garden' });

    const aot = byId(b.events, '425087');
    expect(aot.observation.status).toBe('finished');
    expect(aot.observation.score?.periods?.ot).toEqual({ home: 7, away: expect.any(Number) });
    expect(duration(aot)).toBe(135 + 20);

    expect(byId(b.events, '425095').observation.status).toBe('cancelled');
    const semi = byId(b.events, '442424');
    expect(semi.stageLabel).toBe('Semi-finals');
    expect(b.stages).toEqual([
      expect.objectContaining({ providerLabel: 'Semi-finals', kind: 'semi_final', season: semi.season }),
    ]);
    expect(b.participants.every((p) => p.reference && p.kind === null)).toBe(true);
  });

  it('beisebol: entradas, hits/erros e desfechos sem jogo (adiado, abandonado, cancelado)', () => {
    const b = games('baseball', 'games-1-2024.json');
    const ft = byId(b.events, '152753');
    expect(ft.observation.score).toMatchObject({
      home: 1,
      away: 14,
      breakdown: { home: { hits: 7, errors: 0 }, away: { hits: 12, errors: 0 } },
    });
    expect(ft.observation.score?.periods).toMatchObject({
      i1: { home: 0, away: 8 },
      i9: { home: 0, away: 0 },
    });
    expect(ft.observation.score?.periods?.extra).toBeUndefined();
    expect(duration(ft)).toBe(180);
    expect(byId(b.events, '152887').observation.status).toBe('postponed');
    expect(byId(b.events, '152941').observation.status).toBe('abandoned');
    expect(byId(b.events, '153069').observation.status).toBe('cancelled');
    expect(byId(b.events, '154681').stageLabel).toBe('Final');
  });

  it('hóquei: períodos "a-b", prorrogação e pênaltis', () => {
    const b = games('hockey', 'games-57-2024.json');
    expect(byId(b.events, '370289').observation.score).toEqual({
      home: 2,
      away: 1,
      periods: { p1: { home: 0, away: 0 }, p2: { home: 1, away: 0 }, p3: { home: 1, away: 1 } },
    });
    const ap = byId(b.events, '370388');
    expect(ap.observation).toMatchObject({ status: 'finished', statusDetail: 'AP' });
    expect(ap.observation.score?.periods?.so).toEqual({ home: 2, away: 0 });
    expect(duration(ap)).toBe(150 + 30);
    expect(byId(b.events, '370293').observation.statusDetail).toBe('AOT');
    expect(byId(b.events, '394278').stageLabel).toBe('Quarter-finals');
  });

  it('vôlei: placar em sets e pontos por set; rodada numérica vira fase regular', () => {
    const b = games('volleyball', 'games-132-2024.json');
    const ft = byId(b.events, '168698');
    expect(ft.observation.score).toEqual({
      home: 3,
      away: 0,
      periods: {
        s1: { home: 27, away: 25 },
        s2: { home: 25, away: 23 },
        s3: { home: 25, away: 22 },
      },
    });
    expect(ft.stageLabel).toBe('Regular Season - 1');
    expect(b.stages.find((s) => s.providerLabel === 'Regular Season - 1')).toMatchObject({
      kind: 'regular',
      name: { 'pt-BR': 'Rodada 1' },
    });
    expect(duration(ft)).toBe(120);
    expect(b.competitions[0]!.logoUrl).toBe('https://media.api-sports.io/volley/leagues/132.png');
  });

  it('handebol e rúgbi: dois tempos (+ prorrogação no rúgbi)', () => {
    const h = byId(games('handball', 'games-39-2024.json').events, '166376');
    expect(h.observation.score).toEqual({
      home: 28,
      away: 32,
      halftime: { home: 15, away: 15 },
      extratime: null,
      periods: { h1: { home: 15, away: 15 }, h2: { home: 13, away: 17 } },
    });
    expect(duration(h)).toBe(105);
    const r = games('rugby', 'games-16-2024.json');
    const final = byId(r.events, '49688');
    expect(final.observation).toMatchObject({ status: 'finished', statusDetail: 'AET' });
    expect(final.observation.score?.periods?.ot).toEqual({ home: 6, away: 0 });
    expect(duration(final)).toBe(110 + 25);
    expect(final.stageLabel).toBe('Final');
    expect(duration(byId(r.events, '45917'))).toBe(110);
  });

  it('handebol: intervalo e prorrogação (AET, pela diferença) como no futebol; o AP fica só com os dois tempos', () => {
    const b = games('handball', 'games-aet-ap-2024.json');
    const final = byId(b.events, '157205');
    expect(final.observation).toMatchObject({ status: 'finished', statusDetail: 'AET' });
    expect(final.observation.score).toEqual({
      home: 33,
      away: 31,
      halftime: { home: 14, away: 14 },
      extratime: { home: 6, away: 4 },
      periods: { h1: { home: 14, away: 14 }, h2: { home: 13, away: 13 }, ot: { home: 6, away: 4 } },
    });
    expect(final.stageLabel).toBe('Final');
    expect(duration(final)).toBe(105 + 25);
    expect(byId(b.events, '157176').observation.score?.periods?.ot).toEqual({ home: 7, away: 3 });
    const ap = byId(b.events, '175399');
    expect(ap.observation).toMatchObject({ status: 'finished', statusDetail: 'AP' });
    expect(ap.observation.score).toEqual({
      home: 24,
      away: 26,
      halftime: { home: 11, away: 10 },
      extratime: null,
      periods: { h1: { home: 11, away: 10 }, h2: { home: 8, away: 12 } },
    });
  });

  it('AFL: id aninhado em game, placar com goals/behinds e rodada da temporada regular', () => {
    const b = games('afl', 'games-1-2024.json');
    const ft = byId(b.events, '2952');
    expect(b.competitions[0]).toMatchObject({ id: '1', name: 'AFL Premiership', countryCode: 'AU' });
    expect(ft.observation.startsAt.toISOString()).toBe('2024-03-07T08:30:00.000Z');
    expect(ft.observation.score).toMatchObject({
      home: 86,
      away: 64,
      breakdown: { home: { goals: 12, behinds: 14 }, away: { goals: 9, behinds: 10 } },
    });
    expect(ft.stageLabel).toBe('Regular Season - 0');
    expect(duration(ft)).toBe(165);
    const canc = byId(b.events, '2871');
    expect(canc.observation.status).toBe('cancelled');
    expect(canc.participants.map((p) => p.result)).toEqual([
      { score: 0, winner: null },
      { score: 0, winner: null },
    ]);
  });

  it('NFL: jogo aninhado, "Final/OT" sem código curto, semanas e pós-temporada', () => {
    const b = games('american-football', 'games-1-2024.json');
    const ot = byId(b.events, '13200');
    expect(ot.observation).toMatchObject({ status: 'finished', statusDetail: 'Final/OT' });
    expect(ot.observation.score?.periods?.ot).toEqual({ home: 6, away: expect.any(Number) });
    expect(duration(ot)).toBe(210 + 20);
    expect(ot.stageLabel).toBe('Regular Season - Week 1');
    const pre = byId(b.events, '13146');
    expect(pre.stageLabel).toBe('Pre Season - Hall of Fame Weekend');
    expect(byId(b.events, '17148').observation.status).toBe('scheduled');
    expect(b.stages.find((s) => s.providerLabel === 'Post Season - Pro Bowl')).toMatchObject({
      kind: 'friendly',
    });
  });

  it('NBA v2: liga em texto, visitantes = away, logos da Wikimedia fora dos assets', () => {
    const b = games('nba', 'games-date-2026-05-17.json');
    expect(b.competitions[0]).toMatchObject({
      id: 'standard',
      seasons: [{ year: 2025, label: '2025/26', startDate: null, endDate: null }],
    });
    const e = b.events[0]!;
    expect(e.observation).toMatchObject({ status: 'scheduled', statusDetail: 'Scheduled' });
    expect(e.participants.map((p) => [p.participantId, p.side])).toEqual([
      ['31', 'home'],
      ['22', 'away'],
    ]);
    expect(b.participants.every((p) => p.logoUrl === null)).toBe(true);
    expect(e.stageLabel).toBe('stage-3');
    expect(duration(e)).toBe(135);
  });

  it('NBA v2: em andamento no intervalo vira break; prorrogação nas parciais', () => {
    const live = {
      id: 1,
      league: 'standard',
      season: 2024,
      date: { start: '2025-01-10T00:30:00.000Z' },
      stage: 2,
      status: { clock: null, halftime: true, short: 2, long: 'In Play' },
      periods: { current: 2, total: 4, endOfPeriod: false },
      teams: { visitors: { id: 2, name: 'Boston Celtics' }, home: { id: 17, name: 'Los Angeles Lakers' } },
      scores: {
        visitors: { linescore: ['30', '25'], points: 55 },
        home: { linescore: ['28', '29'], points: 57 },
      },
    };
    const e = normalizeSportGames('nba', [live], FETCHED).events[0]!;
    expect(e.observation).toMatchObject({ status: 'break', statusDetail: 'In Play' });
    expect(e.observation.clock).toEqual({ minute: null, extra: null, period: 'Q2' });
    expect(e.observation.score).toEqual({
      home: 57,
      away: 55,
      periods: { q1: { home: 28, away: 30 }, q2: { home: 29, away: 25 } },
    });
  });

  it('código desconhecido vira status null (a máquina descarta) e item sem id é ignorado', () => {
    const b = normalizeSportGames(
      'volleyball',
      [
        {
          id: 9,
          timestamp: 1725458400,
          status: { short: 'XYZ', long: 'Mistério' },
          league: { id: 25, name: 'Superliga', season: 2024 },
          teams: { home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' } },
          scores: {},
        },
        { status: { short: 'FT' } },
      ],
      FETCHED,
    );
    expect(b.events).toHaveLength(1);
    expect(b.events[0]!.observation.status).toBeNull();
  });
});

describe('fases', () => {
  it('roundStage cobre rodada numérica, AFL pós-temporada e prefixo de liga', () => {
    expect(roundStage({ week: '12' })?.label).toBe('Regular Season - 12');
    expect(roundStage({ round: 'Post Season', week: 26 })).toMatchObject({
      label: 'Play-offs - 26',
      kind: 'playoff',
    });
    expect(roundStage({ week: 'NBA - Final' })).toMatchObject({ label: 'Final', kind: 'final' });
    expect(roundStage({ week: '3rd place' })?.kind).toBe('third_place');
    expect(roundStage({ week: '' })).toBeNull();
  });

  it('nflStage e nbaStage', () => {
    expect(nflStage('Post Season', 'Super Bowl')).toMatchObject({
      kind: 'final',
      name: { 'pt-BR': 'Super Bowl' },
    });
    expect(nflStage('Post Season', 'Divisional Round')?.kind).toBe('quarter_final');
    expect(nflStage('Regular Season', 'Week 18')).toMatchObject({
      kind: 'regular',
      name: { 'pt-BR': 'Semana 18' },
    });
    expect(nflStage(null, null)).toBeNull();
    expect(nbaStage(2)?.kind).toBe('regular');
    expect(nbaStage(1)?.kind).toBe('friendly');
    expect(nbaStage(null)).toBeNull();
  });

  it('seasonYear aceita número, texto e temporada cruzada', () => {
    expect(seasonYear(2024)).toBe(2024);
    expect(seasonYear('2024-2025')).toBe(2024);
    expect(seasonYear(undefined)).toBeNull();
  });
});

describe('classificação', () => {
  const standings = (sport: ApiSportsOtherSport, file: string) => {
    const env = loadSportFixture(sport, file);
    return normalizeSportStandings(sport, env.response, FETCHED, env.parameters);
  };

  it('basquete: grupo, vitórias como pontos e saldo de pontos', () => {
    const b = standings('basketball', 'standings-12-2024-2025.json');
    expect(b.standings[0]).toEqual({
      season: { competitionId: '12', year: 2024 },
      group: 'Western Conference',
      participantId: '152',
      rank: 1,
      points: 68,
      played: 82,
      won: 68,
      drawn: 0,
      lost: 14,
      goalsFor: 9881,
      goalsAgainst: 8826,
      form: 'WWWWL',
      description: 'Promotion - NBA (Play Offs: 1/8-finals)',
    });
  });

  it('hóquei soma vitórias e derrotas na prorrogação; handebol tem empates e pontos', () => {
    const h = standings('hockey', 'standings-57-2024.json').standings[0]!;
    expect(h).toMatchObject({ won: 43 + 13, lost: 22 + 4, points: 116, played: 82 });
    const hb = standings('handball', 'standings-39-2024.json').standings[0]!;
    expect(hb).toMatchObject({
      group: 'Bundesliga - Regular Season',
      won: 27,
      drawn: 4,
      lost: 3,
      points: 58,
    });
  });

  it('AFL (sem liga na linha), NFL (divisões) e NBA v2 (conferências)', () => {
    const afl = standings('afl', 'standings-1-2024.json');
    expect(afl.standings[0]).toMatchObject({
      season: { competitionId: '1', year: 2024 },
      rank: 1,
      points: 68,
      won: 17,
      lost: 6,
      goalsFor: 2242,
      form: 'WWWLL',
    });
    const nfl = standings('american-football', 'standings-1-2024.json');
    expect(nfl.standings[0]).toMatchObject({ group: 'AFC East', won: 13, lost: 4, drawn: 0, goalsFor: 525 });
    const nba = standings('nba', 'standings-standard-2024.json');
    // o fornecedor às vezes devolve total = 0: soma casa + fora
    expect(nba.standings[0]).toMatchObject({
      season: { competitionId: 'standard', year: 2024 },
      group: 'east',
      rank: 2,
      won: 61,
      lost: 21,
      points: 61,
    });
  });
});

describe('Fórmula 1', () => {
  const races = loadSportFixture('formula-1', 'races-2024.json');
  const b = normalizeF1Races(races.response, FETCHED);

  it('cada sessão vira evento na fase do GP (race_weekend) do campeonato sintético', () => {
    expect(b.competitions).toEqual([
      expect.objectContaining({
        id: 'world-championship',
        seasons: [expect.objectContaining({ year: 2024 })],
      }),
    ]);
    const race = byId(b.events, '1857');
    expect(race).toMatchObject({ stageLabel: 'grand-prix-2', venueId: '2', participants: [] });
    expect(race.observation).toMatchObject({ status: 'finished', statusDetail: 'Completed', score: null });
    expect(duration(race)).toBe(120);
    expect(duration(byId(b.events, '1858'))).toBe(25); // 1st Qualifying
    expect(duration(byId(b.events, '1861'))).toBe(60); // 1st Practice
    const bahrain = b.stages.find((s) => s.providerLabel === 'grand-prix-2')!;
    expect(bahrain).toMatchObject({ kind: 'race_weekend', name: { 'pt-BR': 'Bahrain Grand Prix' } });
    // treinos (quinta) e corrida (sábado) caem na mesma semana: a ordem do GP não oscila
    expect(new Set(b.stages.map((s) => s.order)).size).toBe(b.stages.length);
    expect(b.venues[0]).toMatchObject({ id: '2', city: 'Sakhir', countryName: 'Bahrain', reference: true });
    expect(race.sportEvent).toMatchObject({ kind: 'race', providerEventId: '1857' });
  });

  it('a janela da temporada sai do calendário (a API não tem datas de temporada)', () => {
    const days = b.events.map((e) => e.observation.startsAt.toISOString().slice(0, 10)).sort();
    expect(b.competitions[0]!.seasons[0]).toMatchObject({
      year: 2024,
      startDate: days[0],
      endDate: days.at(-1),
    });
  });

  it('resultado e grid completam o evento com N pilotos sem passar pela máquina de estados', () => {
    const results = loadSportFixture('formula-1', 'rankings-races-1967.json');
    const r = normalizeF1RaceRanking('results', results.response, FETCHED, results.parameters);
    expect(r.events).toEqual([]);
    expect(r.eventSupplements).toHaveLength(1);
    const s = r.eventSupplements[0]!;
    expect(s.eventId).toBe('1967');
    expect(s.participants[0]).toEqual({
      participantId: 'driver-25',
      side: 'grid',
      position: 1,
      result: {
        position: 1,
        time: '1:31:05.323',
        laps: 57,
        grid: 2,
        pits: 3,
        gap: null,
        team: { id: 1, name: 'Red Bull Racing' },
      },
    });
    expect(s.detail).toEqual({ results: results.response });
    expect(r.participants.find((p) => p.id === 'driver-25')).toMatchObject({
      kind: 'driver',
      code: 'VER',
      logoKind: 'driver',
    });
    expect(r.participants.find((p) => p.id === '1')).toMatchObject({ kind: 'constructor', reference: true });

    const grid = loadSportFixture('formula-1', 'rankings-startinggrid-1967.json');
    const g = normalizeF1RaceRanking('startinggrid', grid.response, FETCHED, grid.parameters);
    expect(g.eventSupplements[0]!.participants[0]).toMatchObject({
      participantId: 'driver-51',
      position: null,
      result: { grid: 1, qualifying_time: '1:20.575' },
    });
  });

  it('rankings de pilotos e construtores viram duas tabelas da temporada', () => {
    const drivers = loadSportFixture('formula-1', 'rankings-drivers-2024.json');
    const d = normalizeF1Standings('drivers', drivers.response, FETCHED, drivers.parameters);
    expect(d.standings[0]).toMatchObject({
      season: { competitionId: 'world-championship', year: 2024 },
      group: 'drivers',
      participantId: 'driver-25',
      rank: 1,
      points: 437,
      won: 9,
    });
    const teams = loadSportFixture('formula-1', 'rankings-teams-2024.json');
    const t = normalizeF1Standings('constructors', teams.response, FETCHED, teams.parameters);
    expect(t.standings[0]).toMatchObject({ group: 'constructors', participantId: '2', rank: 1, points: 666 });
  });

  it('duração por tipo de sessão', () => {
    expect(f1SessionMinutes('Race')).toBe(120);
    expect(f1SessionMinutes('Sprint')).toBe(60);
    expect(f1SessionMinutes('2nd Sprint Shootout')).toBe(20);
    expect(f1SessionMinutes('3rd Qualifying')).toBe(25);
    expect(f1SessionMinutes('Qualifying')).toBe(60);
    expect(f1SessionMinutes('2nd Practice')).toBe(60);
  });
});

describe('MMA', () => {
  const env = loadSportFixture('mma', 'fights-2024.json');
  const b = normalizeMmaFights(env.response, FETCHED, env.parameters);

  it('lutas viram eventos com os dois cantos na fase da categoria de peso', () => {
    const f = byId(b.events, '1097');
    expect(f.season).toEqual({ competitionId: 'all-fights', year: 2024 });
    expect(f.stageLabel).toBe('category-Bantamweight');
    expect(b.stages.find((s) => s.providerLabel === 'category-Bantamweight')).toMatchObject({
      kind: 'other',
      name: { 'pt-BR': 'Peso-galo', es: 'Peso gallo' },
    });
    expect(f.participants).toEqual([
      { participantId: '2554', side: 'corner_red', position: null, result: { winner: false } },
      { participantId: '2580', side: 'corner_blue', position: null, result: { winner: true } },
    ]);
    expect(b.participants.find((p) => p.id === '2554')).toMatchObject({
      kind: 'fighter',
      name: 'Gaston Bolaños',
      logoKind: 'fighter',
    });
    expect(f.observation).toMatchObject({ status: 'finished', statusDetail: 'FT', score: null });
  });

  it('o fim previsto acompanha o bloco do card (variável)', () => {
    // bloco das 13:00 com 2 lutas preliminares → 60 min; bloco com card principal → +15
    expect(duration(byId(b.events, '1097'))).toBe(2 * 30);
    expect(duration(byId(b.events, '1095'))).toBe(30 + 15);
  });

  it('cancelada e pré-luta', () => {
    const statuses = b.events.map((e) => e.observation.status);
    expect(statuses).toContain('cancelled');
    const pf = b.events.find((e) => e.observation.statusDetail === 'PF')!;
    expect(pf.observation.status).toBe('scheduled');
  });

  it('fights/results soma o desfecho ao espelho da luta', () => {
    const res = loadSportFixture('mma', 'fights-results-1097.json');
    const r = normalizeMmaResults(res.response, FETCHED);
    expect(r.eventSupplements).toEqual([
      { eventId: '1097', participants: [], detail: { result: res.response[0] } },
    ]);
  });

  it('categorias femininas e desconhecidas', () => {
    expect(mmaCategoryStage("Women's Strawweight")?.name).toMatchObject({ 'pt-BR': 'Peso-palha feminino' });
    expect(mmaCategoryStage('Catch Weight')?.name).toMatchObject({ es: 'Peso pactado' });
    expect(mmaCategoryStage('Bare Knuckle')?.name).toMatchObject({ 'pt-BR': 'Bare Knuckle' });
    expect(mmaCategoryStage('')).toBeNull();
  });
});

describe('times', () => {
  it('v1 clássico e NBA v2 → participantes completos (seleção quando national)', () => {
    const b = normalizeSportTeams(
      'basketball',
      [
        {
          id: 1,
          name: 'Brazil',
          national: true,
          logo: 'https://media.api-sports.io/basketball/teams/1.png',
          country: { name: 'Brazil', code: 'BR' },
        },
        { id: 2, name: 'Franca', national: false, logo: null, country: { name: 'Brazil', code: 'BR' } },
      ],
      FETCHED,
    );
    expect(b.participants.map((p) => [p.id, p.kind, p.countryCode])).toEqual([
      ['1', 'national_team', 'BR'],
      ['2', 'club', 'BR'],
    ]);
    const nba = normalizeSportTeams(
      'nba',
      [
        {
          id: 2,
          name: 'Boston Celtics',
          nickname: 'Celtics',
          code: 'BOS',
          logo: 'https://upload.wikimedia.org/x.svg',
        },
      ],
      FETCHED,
    );
    expect(nba.participants[0]).toMatchObject({ shortName: 'Celtics', code: 'BOS', logoUrl: null });
  });
});

describe('despacho por endpoint', () => {
  it('cada esporte tem a sua lista de endpoints; o resto devolve null', () => {
    for (const sport of API_SPORTS_OTHER_SPORTS)
      expect(NORMALIZABLE_SPORT_ENDPOINTS[sport].length).toBeGreaterThan(0);
    expect(normalizeSportEnvelope('basketball', '/odds', { response: [] }, FETCHED)).toBeNull();
    expect(normalizeSportEnvelope('mma', '/games', { response: [] }, FETCHED)).toBeNull();
    const env = loadSportFixture('volleyball', 'games-132-2024.json');
    expect(normalizeSportEnvelope('volleyball', '/games', env, FETCHED)?.items).toBe(3);
    expect(normalizeSportEnvelope('volleyball', '/games/h2h', { response: [] }, FETCHED)?.items).toBe(0);
  });

  it('todos os esportes têm duração esperada', () => {
    for (const sport of API_SPORTS_OTHER_SPORTS) expect(EXPECTED_DURATION_MIN[sport]).toBeGreaterThan(0);
  });
});
