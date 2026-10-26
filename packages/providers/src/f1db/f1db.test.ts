/** F1DB: casamento com a api-sports e normalização (release mínimo: Brasil 2024 casa, Japão 1988 só no F1DB). */
import { describe, expect, it } from 'vitest';
import { matchF1db } from './match.js';
import { f1dbCountries, f1dbDriverEntries, f1dbEntrants, normalizeF1db } from './normalize.js';
import { sessionStart } from './schedule.js';
import type { CoreF1Snapshot, CoreRaceEvent } from './match.js';
import { f1dbSeasonRange, sliceF1dbSeasons, type F1dbRow, type F1dbTables } from './tables.js';

const result = (
  raceId: number,
  order: number,
  driver: string,
  constructor: string,
  extra: F1dbRow = {},
): F1dbRow => ({
  race_id: raceId,
  type: 'RACE_RESULT',
  position_display_order: order,
  position_number: order,
  position_text: String(order),
  driver_id: driver,
  constructor_id: constructor,
  race_laps: 71,
  ...extra,
});

function f1dbTables(): F1dbTables {
  return {
    country: [
      { id: 'netherlands', alpha2_code: 'NL', name: 'Netherlands' },
      { id: 'france', alpha2_code: 'FR', name: 'France' },
      { id: 'brazil', alpha2_code: 'BR', name: 'Brazil' },
      { id: 'mexico', alpha2_code: 'MX', name: 'Mexico' },
      { id: 'austria', alpha2_code: 'AT', name: 'Austria' },
      { id: 'united-kingdom', alpha2_code: 'GB', name: 'United Kingdom' },
      { id: 'japan', alpha2_code: 'JP', name: 'Japan' },
    ],
    driver: [
      {
        id: 'max-verstappen',
        name: 'Max Verstappen',
        last_name: 'Verstappen',
        abbreviation: 'VER',
        nationality_country_id: 'netherlands',
        permanent_number: '33',
      },
      {
        id: 'esteban-ocon',
        name: 'Esteban Ocon',
        last_name: 'Ocon',
        abbreviation: 'OCO',
        nationality_country_id: 'france',
      },
      {
        id: 'pierre-gasly',
        name: 'Pierre Gasly',
        last_name: 'Gasly',
        abbreviation: 'GAS',
        nationality_country_id: 'france',
      },
      {
        id: 'sergio-perez',
        name: 'Sergio Pérez',
        last_name: 'Pérez',
        abbreviation: 'PER',
        nationality_country_id: 'mexico',
      },
      {
        id: 'ayrton-senna',
        name: 'Ayrton Senna',
        last_name: 'Senna',
        abbreviation: 'SEN',
        nationality_country_id: 'brazil',
        date_of_birth: '1960-03-21',
        place_of_birth: 'São Paulo',
        country_of_birth_country_id: 'brazil',
      },
      {
        id: 'alain-prost',
        name: 'Alain Prost',
        last_name: 'Prost',
        abbreviation: 'PRO',
        nationality_country_id: 'france',
      },
    ],
    constructor: [
      { id: 'red-bull', name: 'Red Bull', full_name: 'Red Bull Racing', country_id: 'austria' },
      { id: 'alpine', name: 'Alpine', full_name: 'Alpine F1 Team', country_id: 'france' },
      { id: 'mclaren', name: 'McLaren', full_name: 'McLaren Racing', country_id: 'united-kingdom' },
      { id: 'caterham', name: 'Caterham', full_name: 'Caterham F1 Team', country_id: 'united-kingdom' },
      { id: 'lotus', name: 'Lotus', full_name: 'Team Lotus', country_id: 'united-kingdom' },
    ],
    circuit: [
      {
        id: 'interlagos',
        name: 'José Carlos Pace',
        full_name: 'Autódromo José Carlos Pace',
        place_name: 'São Paulo',
        country_id: 'brazil',
        longitude: -46.697,
      },
      {
        id: 'suzuka',
        name: 'Suzuka',
        full_name: 'Suzuka Circuit',
        place_name: 'Suzuka',
        country_id: 'japan',
        longitude: 136.54,
      },
      {
        id: 'istanbul',
        name: 'Istanbul Park',
        full_name: 'Istanbul Park',
        place_name: 'Tuzla',
        country_id: 'turkey',
        longitude: 29.4,
      },
    ],
    grand_prix: [
      { id: 'sao-paulo', full_name: 'São Paulo Grand Prix' },
      { id: 'japan', full_name: 'Japanese Grand Prix' },
    ],
    race: [
      {
        id: 1100,
        year: 2024,
        round: 21,
        date: '2024-11-03',
        time: '15:30',
        grand_prix_id: 'sao-paulo',
        circuit_id: 'interlagos',
        laps: 69,
        distance: 297.9,
        sprint_race_date: '2024-11-02',
        sprint_race_time: '14:00',
      },
      {
        id: 470,
        year: 1988,
        round: 15,
        date: '1988-10-30',
        grand_prix_id: 'japan',
        circuit_id: 'suzuka',
        laps: 51,
        distance: 298.9,
      },
      // GP do calendário ainda sem resultado (release no meio da temporada): não vira sessão, mas fecha a temporada
      { id: 471, year: 1988, round: 16, date: '1988-11-13', grand_prix_id: 'japan', circuit_id: 'suzuka' },
    ],
    race_data: [
      result(1100, 1, 'max-verstappen', 'red-bull', { race_grid_position_number: 17 }),
      result(1100, 2, 'esteban-ocon', 'alpine'),
      result(1100, 3, 'pierre-gasly', 'alpine'),
      {
        race_id: 1100,
        type: 'SPRINT_RACE_RESULT',
        position_display_order: 1,
        position_number: 1,
        position_text: '1',
        driver_id: 'esteban-ocon',
        constructor_id: 'alpine',
      },
      result(470, 1, 'ayrton-senna', 'mclaren', {
        race_time: '1:33:26.173',
        race_points: 9,
        race_grid_position_number: 1,
      }),
      result(470, 2, 'alain-prost', 'mclaren', { race_gap: '+13.363', race_points: 6 }),
      {
        race_id: 470,
        type: 'RACE_RESULT',
        position_display_order: 3,
        position_text: 'DNF',
        driver_id: 'sergio-perez',
        constructor_id: 'lotus',
        race_reason_retired: 'Engine',
      },
      {
        race_id: 470,
        type: 'RACE_RESULT',
        position_display_order: 4,
        position_text: 'DNQ',
        driver_id: 'pierre-gasly',
        constructor_id: 'lotus',
      },
      {
        race_id: 470,
        type: 'QUALIFYING_RESULT',
        position_display_order: 1,
        position_number: 1,
        position_text: '1',
        driver_id: 'ayrton-senna',
        constructor_id: 'mclaren',
        qualifying_time: '1:41.853',
      },
      {
        race_id: 470,
        type: 'PIT_STOP',
        driver_id: 'alain-prost',
        constructor_id: 'mclaren',
        pit_stop_stop: 1,
        pit_stop_lap: 30,
        pit_stop_time: '9.1',
      },
      {
        race_id: 470,
        type: 'FASTEST_LAP',
        position_number: 1,
        driver_id: 'alain-prost',
        fastest_lap_time: '1:46.326',
      },
    ],
    season_constructor: [
      { year: 2024, constructor_id: 'red-bull' },
      { year: 2024, constructor_id: 'alpine' },
      { year: 2014, constructor_id: 'caterham' },
      { year: 1988, constructor_id: 'mclaren', total_race_wins: 15, total_race_starts: 32 },
    ],
    season_driver: [{ year: 1988, driver_id: 'ayrton-senna', total_race_wins: 8, total_race_starts: 16 }],
    season_driver_standing: [
      {
        year: 1988,
        position_display_order: 1,
        position_number: 1,
        driver_id: 'ayrton-senna',
        points: 90,
        championship_won: 1,
      },
      { year: 1988, position_display_order: 2, position_number: 2, driver_id: 'alain-prost', points: 87.5 },
    ],
    season_constructor_standing: [
      { year: 1988, position_display_order: 1, position_number: 1, constructor_id: 'mclaren', points: 199 },
    ],
  };
}

const coreRace = (over: Partial<CoreRaceEvent>): CoreRaceEvent => ({
  entityId: 'ev-race',
  startsAt: new Date('2024-11-03T15:30:00Z'),
  sessionType: 'Race',
  stageLabel: 'grand-prix-22',
  seasonYear: 2024,
  venueProviderId: '22',
  results: [],
  ...over,
});

/** Core com a F1 2024 da api-sports: GP do Brasil (corrida, sprint e Q1), três pilotos e duas equipes. */
function coreSnapshot(): CoreF1Snapshot {
  return {
    participants: [
      { providerId: 'driver-25', entityId: 'p-ver', name: 'Max Verstappen', kind: 'driver', code: 'VER' },
      { providerId: 'driver-28', entityId: 'p-oco', name: 'Esteban Ocon', kind: 'driver', code: 'OCO' },
      { providerId: 'driver-36', entityId: 'p-gas', name: 'Pierre Gasly', kind: 'driver', code: 'GAS' },
      { providerId: 'driver-10', entityId: 'p-per', name: 'Sergio Perez', kind: 'driver', code: 'PER' },
      { providerId: '1', entityId: 't-rbr', name: 'Red Bull Racing', kind: 'constructor', code: null },
      { providerId: '13', entityId: 't-alp', name: 'Alpine F1 Team', kind: 'constructor', code: null },
      { providerId: '10', entityId: 't-cat', name: 'Caterham F1 Team', kind: 'constructor', code: null },
    ],
    venues: [
      { providerId: '22', entityId: 'v-int', name: 'Autódromo José Carlos Pace', city: 'São Paulo' },
      { providerId: '28', entityId: 'v-ist', name: 'Intercity Istanbul Park', city: 'Istanbul' },
    ],
    events: [
      coreRace({
        results: [
          { participantProviderId: 'driver-25', position: 1, teamProviderId: '1' },
          { participantProviderId: 'driver-28', position: 2, teamProviderId: '13' },
          { participantProviderId: 'driver-36', position: 3, teamProviderId: '13' },
        ],
      }),
      coreRace({ entityId: 'ev-sprint', sessionType: 'Sprint', startsAt: new Date('2024-11-02T14:00:00Z') }),
      coreRace({
        entityId: 'ev-q1',
        sessionType: '1st Qualifying',
        startsAt: new Date('2024-11-03T10:30:00Z'),
      }),
    ],
    linked: { participants: new Map(), venues: new Map(), events: new Map() },
  };
}

describe('matchF1db', () => {
  it('casa a corrida pelo dia e as sessões do GP pelo tipo; o GP fica coberto', () => {
    const links = matchF1db(f1dbTables(), coreSnapshot());
    expect(links.coveredRaces).toEqual(new Set(['1100']));
    expect(links.events.get('race-1100-race')).toBe('ev-race');
    expect(links.events.get('race-1100-sprint')).toBe('ev-sprint');
    // a classificação inteira do F1DB não tem par (a outra fonte separa Q1/Q2/Q3)
    expect([...links.events.values()]).not.toContain('ev-q1');
    expect(links.stageLabels.get('sao-paulo')).toBe('grand-prix-22');
    expect(links.report.racesMatched).toBe(1);
  });

  it('casa pilotos pela posição final (conferindo o sobrenome) e as equipes deles', () => {
    const links = matchF1db(f1dbTables(), coreSnapshot());
    expect(links.participants.get('driver-max-verstappen')).toBe('p-ver');
    expect(links.participants.get('driver-esteban-ocon')).toBe('p-oco');
    expect(links.participants.get('driver-pierre-gasly')).toBe('p-gas');
    expect(links.participants.get('red-bull')).toBe('t-rbr');
    expect(links.participants.get('alpine')).toBe('t-alp');
    expect(links.report.drivers.byResults).toBe(3);
    expect(links.report.constructors.byResults).toBe(2);
  });

  it('recusa o par quando o sobrenome não bate na mesma posição (o nome resolve depois)', () => {
    const core = coreSnapshot();
    core.events[0]!.results[0] = { participantProviderId: 'driver-10', position: 1, teamProviderId: '1' };
    const links = matchF1db(f1dbTables(), core);
    expect(links.report.conflicts.some((c) => c.includes('max-verstappen'))).toBe(true);
    expect(links.report.drivers.byResults).toBe(2);
    // Pérez não vira Verstappen: cada um casa com o seu pelo nome
    expect(links.participants.get('driver-max-verstappen')).toBe('p-ver');
    expect(links.participants.get('driver-sergio-perez')).toBe('p-per');
  });

  it('sem corrida em comum, casa pelo nome sem acento e só com candidato único', () => {
    const links = matchF1db(f1dbTables(), coreSnapshot());
    // "Sergio Perez" (api-sports) × "Sergio Pérez" (F1DB)
    expect(links.participants.get('driver-sergio-perez')).toBe('p-per');
    // equipe histórica da outra fonte: nome igual, mas só entre os construtores de 2010 em diante
    expect(links.participants.get('caterham')).toBe('t-cat');
    expect(links.participants.get('lotus')).toBeUndefined();
  });

  it('casa circuitos pela corrida e pelo nome contido no outro', () => {
    const links = matchF1db(f1dbTables(), coreSnapshot());
    expect(links.venues.get('interlagos')).toBe('v-int');
    expect(links.venues.get('istanbul')).toBe('v-ist');
    expect(links.venues.get('suzuka')).toBeUndefined();
  });

  it('respeita vínculos já gravados e não refaz nada na segunda rodada', () => {
    const core = coreSnapshot();
    core.linked.participants.set('driver-max-verstappen', 'p-ver');
    core.linked.events.set('race-1100-race', 'ev-race');
    const links = matchF1db(f1dbTables(), core);
    expect(links.created.participants.map((c) => c.providerId)).not.toContain('driver-max-verstappen');
    expect(links.created.events.map((c) => c.providerId)).not.toContain('race-1100-race');
    expect(links.participants.get('driver-max-verstappen')).toBe('p-ver');
    const again = matchF1db(f1dbTables(), {
      ...core,
      linked: { participants: links.participants, venues: links.venues, events: links.events },
    });
    expect(again.created).toEqual({ participants: [], venues: [], events: [] });
  });

  it('nome exato primeiro: o par exato de um libera o candidato único do outro', () => {
    const tables = f1dbTables();
    tables.constructor!.push(
      { id: 'manor', name: 'Manor', full_name: 'Manor Racing' },
      { id: 'marussia', name: 'Marussia', full_name: 'Marussia F1 Team' },
    );
    tables.season_constructor!.push(
      { year: 2015, constructor_id: 'manor' },
      { year: 2014, constructor_id: 'marussia' },
    );
    const core = coreSnapshot();
    core.participants.push(
      { providerId: '9', entityId: 't-mm', name: 'Manor Marussia F1 Team', kind: 'constructor', code: null },
      { providerId: '16', entityId: 't-man', name: 'Manor Racing', kind: 'constructor', code: null },
    );
    const links = matchF1db(tables, core);
    expect(links.participants.get('manor')).toBe('t-man');
    expect(links.participants.get('marussia')).toBe('t-mm');
    expect(links.report.named).toContain('construtor "Manor Racing" → manor');
  });

  it('equipe dividida em dois IDs na outra fonte: vence o nome mais parecido entre os votados', () => {
    const tables = f1dbTables();
    tables.constructor!.push(
      { id: 'kick-sauber', name: 'Kick Sauber', full_name: 'Kick Sauber F1 Team' },
      { id: 'sauber', name: 'Sauber', full_name: 'Sauber F1 Team' },
    );
    tables.season_constructor!.push(
      { year: 2024, constructor_id: 'kick-sauber' },
      { year: 2018, constructor_id: 'sauber' },
    );
    for (const r of tables.race_data!)
      if (r.race_id === 1100 && r.type === 'RACE_RESULT' && r.position_number !== 1)
        r.constructor_id = 'kick-sauber';
    // mais dois pilotos da equipe: dois votos para cada ID da outra fonte
    tables.driver!.push(
      { id: 'valtteri-bottas', name: 'Valtteri Bottas', abbreviation: 'BOT' },
      { id: 'guanyu-zhou', name: 'Guanyu Zhou', abbreviation: 'ZHO' },
    );
    tables.race_data!.push(
      {
        race_id: 1100,
        type: 'RACE_RESULT',
        position_number: 4,
        driver_id: 'valtteri-bottas',
        constructor_id: 'kick-sauber',
      },
      {
        race_id: 1100,
        type: 'RACE_RESULT',
        position_number: 5,
        driver_id: 'guanyu-zhou',
        constructor_id: 'kick-sauber',
      },
    );
    const core = coreSnapshot();
    core.participants.push(
      { providerId: 'driver-5', entityId: 'p-bot', name: 'Valtteri Bottas', kind: 'driver', code: 'BOT' },
      { providerId: 'driver-83', entityId: 'p-zho', name: 'Guanyu Zhou', kind: 'driver', code: null },
    );
    core.events[0]!.results.push(
      { participantProviderId: 'driver-5', position: 4, teamProviderId: '8' },
      { participantProviderId: 'driver-83', position: 5, teamProviderId: '18' },
    );
    core.participants.push(
      { providerId: '8', entityId: 't-sau', name: 'Sauber F1 Team', kind: 'constructor', code: null },
      {
        providerId: '18',
        entityId: 't-kick',
        name: 'Stake F1 Team Kick Sauber',
        kind: 'constructor',
        code: null,
      },
    );
    core.events[0]!.results[1]!.teamProviderId = '8';
    core.events[0]!.results[2]!.teamProviderId = '18';
    const links = matchF1db(tables, core);
    expect(links.participants.get('kick-sauber')).toBe('t-kick');
    expect(links.participants.get('sauber')).toBe('t-sau');
  });

  it('equipe que o F1DB divide (RB → Racing Bulls) vira a mesma entidade da outra fonte', () => {
    const tables = f1dbTables();
    tables.constructor!.push(
      { id: 'rb', name: 'RB', full_name: 'Racing Bulls' },
      { id: 'racing-bulls', name: 'Racing Bulls', full_name: 'Racing Bulls' },
    );
    tables.season_constructor!.push(
      { year: 2024, constructor_id: 'rb' },
      { year: 2026, constructor_id: 'racing-bulls' },
    );
    for (const r of tables.race_data!)
      if (r.race_id === 1100 && r.driver_id === 'pierre-gasly') r.constructor_id = 'rb';
    const core = coreSnapshot();
    core.participants.push({
      providerId: '7',
      entityId: 't-rb',
      name: 'Racing Bulls',
      kind: 'constructor',
      code: null,
    });
    core.events[0]!.results[2]!.teamProviderId = '7';
    const links = matchF1db(tables, core);
    expect(links.participants.get('rb')).toBe('t-rb');
    expect(links.participants.get('racing-bulls')).toBe('t-rb');
  });

  it('pela cidade, só entre os circuitos da era da outra fonte (Madri: Madring, não Jarama)', () => {
    const tables = f1dbTables();
    tables.circuit!.push(
      { id: 'jarama', name: 'Jarama', full_name: 'Circuito de Madrid Jarama - RACE', place_name: 'Madrid' },
      { id: 'madring', name: 'Madring', full_name: 'Circuito de Madring', place_name: 'Madrid' },
    );
    tables.race!.push({ id: 1160, year: 2026, round: 16, date: '2026-09-13', circuit_id: 'madring' });
    const core = coreSnapshot();
    core.venues.push({ providerId: '103', entityId: 'v-mad', name: 'Circuit De Espana', city: 'Madrid' });
    expect(matchF1db(tables, core).venues.get('madring')).toBe('v-mad');
  });
});

describe('normalizeF1db', () => {
  const observedAt = new Date('2026-10-23T12:00:00Z');
  const run = () => {
    const tables = f1dbTables();
    const links = matchF1db(tables, coreSnapshot());
    return normalizeF1db(tables, {
      observedAt,
      release: 'v2026.17.0',
      coveredRaces: links.coveredRaces,
      stageLabels: links.stageLabels,
      matchedParticipants: new Set(links.participants.keys()),
      matchedVenues: new Set(links.venues.keys()),
    });
  };

  it('não cria sessões no GP coberto pela outra fonte', () => {
    const batch = run();
    expect(batch.provider).toBe('f1db');
    expect(batch.events.map((e) => e.id).sort()).toEqual(['race-470-qualifying', 'race-470-race']);
    expect(batch.stages).toHaveLength(1);
    expect(batch.stages[0]).toMatchObject({ providerLabel: 'gp-japan', kind: 'race_weekend' });
  });

  it('corrida de 1988: pilotos no grid, abandono na ordem e não classificado de fora', () => {
    const race = run().events.find((e) => e.id === 'race-470-race')!;
    expect(race.observation.status).toBe('finished');
    expect(race.participants.map((p) => [p.participantId, p.position])).toEqual([
      ['driver-ayrton-senna', 1],
      ['driver-alain-prost', 2],
      ['driver-sergio-perez', 3],
    ]);
    expect(race.participants[0]!.result).toMatchObject({
      time: '1:33:26.173',
      grid: 1,
      points: 9,
      team: { id: 'mclaren', name: 'McLaren' },
    });
    expect(race.participants[1]!.result).toMatchObject({ gap: '+13.363', pits: 1 });
    expect(race.participants[2]!.result).toMatchObject({ time: 'DNF', status: 'Engine' });
    expect(race.sportEvent?.summary).toMatchObject({
      source: 'f1db',
      license: 'CC BY 4.0',
      type: 'Race',
      time_estimated: true,
      laps: { total: 51 },
      distance: '298.9 km',
      fastest_lap: { driver: { id: 'alain-prost' }, time: '1:46.326' },
    });
    expect((race.sportEvent?.detail as { pit_stops: unknown[] }).pit_stops).toHaveLength(1);
  });

  it('casados entram como referência; os novos, completos', () => {
    const batch = run();
    const byId = new Map(batch.participants.map((p) => [p.id, p]));
    expect(byId.get('driver-sergio-perez')).toMatchObject({ reference: true, countryCode: 'MX' });
    expect(byId.get('driver-ayrton-senna')).toMatchObject({
      reference: false,
      kind: 'driver',
      code: 'SEN',
      countryCode: 'BR',
      birthDate: '1960-03-21',
      birthPlace: 'São Paulo',
      birthCountryCode: 'BR',
      // sem número permanente antes de 2014: o da época sai das sessões
      number: null,
    });
    expect(byId.get('mclaren')).toMatchObject({ kind: 'constructor', name: 'McLaren' });
  });

  it('campeonato de 1988 com vitórias e pontos arredondados', () => {
    const batch = run();
    expect(batch.standings.map((s) => [s.group, s.participantId, s.rank, s.points, s.won])).toEqual([
      ['drivers', 'driver-ayrton-senna', 1, 90, 8],
      ['drivers', 'driver-alain-prost', 2, 88, 0],
      ['constructors', 'mclaren', 1, 199, 15],
    ]);
    // 2024 só tem GP coberto pela outra fonte: entra pela data do calendário (ver o teste do fim da temporada)
    expect(batch.competitions[0]!.seasons.map((s) => s.year)).toEqual([1988, 2024]);
  });

  it('carro compartilhado: uma linha por piloto, a melhor, com a pole de qualquer uma delas', () => {
    const tables = f1dbTables();
    tables.race_data = [
      ...tables.race_data!.map((r) =>
        r.type === 'RACE_RESULT' && r.driver_id === 'ayrton-senna' ? { ...r, race_pole_position: 1 } : r,
      ),
      // Prost também levou o carro de outro piloto e abandonou com ele (linha depois, na ordem); a pole era dessa
      {
        race_id: 470,
        type: 'RACE_RESULT',
        position_display_order: 5,
        position_text: 'DNF',
        driver_id: 'alain-prost',
        constructor_id: 'mclaren',
        race_shared_car: 1,
        race_pole_position: 1,
      },
    ];
    const race = normalizeF1db(tables, { observedAt, release: 'v2026.17.0' }).events.find(
      (e) => e.id === 'race-470-race',
    )!;
    const prost = race.participants.filter((p) => p.participantId === 'driver-alain-prost');
    expect(prost).toHaveLength(1);
    expect(prost[0]).toMatchObject({ position: 2, result: { position_text: '2', pole: true } });
    const senna = race.participants.find((p) => p.participantId === 'driver-ayrton-senna')!;
    expect(senna.result).toMatchObject({ pole: true });
  });

  it('nome de época da equipe: a inscrição de fábrica; carro particular leva o nome do construtor', () => {
    const entry = (year: number, entrant: string, constructor: string, driver: string, rounds: string) => ({
      year,
      entrant_id: entrant,
      constructor_id: constructor,
      driver_id: driver,
      rounds,
      test_driver: 0,
    });
    const tables = {
      driver: [{ id: 'juan-manuel-fangio', name: 'Juan Manuel Fangio', full_name: 'Juan Manuel Fangio' }],
      constructor: [
        { id: 'mercedes', name: 'Mercedes' },
        { id: 'maserati', name: 'Maserati' },
      ],
      entrant: [
        { id: 'daimler-benz-ag', name: 'Daimler Benz AG' },
        { id: 'officine-alfieri-maserati', name: 'Officine Alfieri Maserati' },
        { id: 'juan-manuel-fangio', name: 'Juan Manuel Fangio' },
        { id: 'scuderia-sud-americana', name: 'Scuderia Sud Americana' },
        { id: 'scuderia-centro-sud', name: 'Scuderia Centro Sud' },
      ],
      season_entrant_driver: [
        entry(1954, 'daimler-benz-ag', 'mercedes', 'juan-manuel-fangio', '4;5;6;7;8;9'),
        entry(1954, 'officine-alfieri-maserati', 'maserati', 'juan-manuel-fangio', '1;3'),
        // 1958: sem a fábrica da Maserati; a Centro Sud é a inscrição com mais etapas
        entry(1958, 'scuderia-centro-sud', 'maserati', 'outro-piloto', '1;2;3;4;5'),
        entry(1958, 'scuderia-sud-americana', 'maserati', 'juan-manuel-fangio', '1'),
        entry(1958, 'juan-manuel-fangio', 'maserati', 'juan-manuel-fangio', '6'),
      ],
    } as F1dbTables;
    const entrantOf = f1dbEntrants(tables);
    expect(entrantOf(1954, 4, 'juan-manuel-fangio', 'mercedes')).toEqual({
      id: 'daimler-benz-ag',
      name: 'Daimler Benz AG',
    });
    expect(entrantOf(1954, 1, 'juan-manuel-fangio', 'maserati')?.name).toBe('Officine Alfieri Maserati');
    // a mesma Maserati em 1958: particular nas duas etapas (Sud Americana e ele mesmo), então "Maserati"
    expect(entrantOf(1958, 1, 'juan-manuel-fangio', 'maserati')?.name).toBe('Maserati');
    expect(entrantOf(1958, 6, 'juan-manuel-fangio', 'maserati')?.name).toBe('Maserati');
    expect(entrantOf(1958, 3, 'outro-piloto', 'maserati')?.name).toBe('Scuderia Centro Sud');
    expect(entrantOf(1960, 1, 'juan-manuel-fangio', 'maserati')).toBeNull();
    // a inscrição da temporada, para a classificação: o nome de época por construtor
    expect(f1dbDriverEntries(tables).get('1954|juan-manuel-fangio')?.teams).toEqual([
      { constructor: 'mercedes', name: 'Daimler Benz AG' },
      { constructor: 'maserati', name: 'Officine Alfieri Maserati' },
    ]);
  });

  it('países do F1DB com nome nos idiomas da API, só os usados', () => {
    const tables = f1dbTables();
    tables.country = [
      ...tables.country!,
      { id: 'monaco', alpha2_code: 'MC', name: 'Monaco' },
      { id: 'nowhere', alpha2_code: 'ZZ', name: 'Nowhere' },
    ];
    tables.driver = [
      ...tables.driver!,
      {
        id: 'charles-leclerc',
        name: 'Charles Leclerc',
        last_name: 'Leclerc',
        nationality_country_id: 'monaco',
      },
    ];
    const countries = f1dbCountries(tables);
    expect(countries.find((c) => c.code === 'MC')).toEqual({
      code: 'MC',
      name: { en: 'Monaco', 'pt-BR': 'Mônaco', es: 'Mónaco' },
    });
    // os dos circuitos também; país que ninguém usa fica de fora
    expect(countries.map((c) => c.code)).toContain('JP');
    expect(countries.map((c) => c.code)).not.toContain('ZZ');
  });

  it('a temporada vai até o último GP do calendário, mesmo sem resultado ainda', () => {
    const season = run().competitions[0]!.seasons.find((s) => s.year === 1988)!;
    expect(season.endDate).toBe('1988-11-13');
    expect(run().events.some((e) => e.id.startsWith('race-471'))).toBe(false);
  });

  it('temporada com todos os GPs cobertos pela outra fonte: o fim também é o último GP do calendário', () => {
    const tables = f1dbTables();
    // GP de 2024 ainda por disputar no release: o de São Paulo (coberto) não é o último
    tables.race!.push({ id: 1101, year: 2024, round: 22, date: '2024-12-08', circuit_id: 'interlagos' });
    const links = matchF1db(tables, coreSnapshot());
    expect(links.coveredRaces).toEqual(new Set(['1100']));
    const batch = normalizeF1db(tables, {
      observedAt,
      release: 'v2026.17.0',
      coveredRaces: links.coveredRaces,
      stageLabels: links.stageLabels,
    });
    expect(batch.events.some((e) => e.id.startsWith('race-1100') || e.id.startsWith('race-1101'))).toBe(
      false,
    );
    expect(batch.competitions[0]!.seasons.find((s) => s.year === 2024)).toMatchObject({
      startDate: '2024-11-03',
      endDate: '2024-12-08',
    });
  });
});

describe('sessionStart', () => {
  it('usa data e hora UTC do release quando existem', () => {
    const r = sessionStart({ date: '2024-11-03', time: '15:30' }, 'race', {
      sprintWeekend: false,
      longitude: -46.7,
    });
    expect(r).toEqual({ startsAt: new Date('2024-11-03T15:30:00Z'), estimated: false });
  });

  it('estima 14h locais pela longitude quando só há a data da corrida', () => {
    const sp = sessionStart({ date: '1988-11-13', year: 1988 }, 'race', {
      sprintWeekend: false,
      longitude: -46.7,
    });
    expect(sp).toEqual({ startsAt: new Date('1988-11-13T17:00:00Z'), estimated: true });
    const q = sessionStart({ date: '1988-10-30', year: 1988 }, 'qualifying', {
      sprintWeekend: false,
      longitude: 136.5,
    });
    expect(q?.startsAt).toEqual(new Date('1988-10-29T05:00:00Z'));
  });

  it('Mônaco antes de 2022: treinos na quinta-feira', () => {
    const r = sessionStart({ date: '1988-05-15', year: 1988, grand_prix_id: 'monaco' }, 'practice-1', {
      sprintWeekend: false,
      longitude: 7.4,
    });
    expect(r?.startsAt.toISOString().slice(0, 10)).toBe('1988-05-12');
  });
});

describe('recorte do release por temporadas', () => {
  const release: F1dbTables = {
    driver: [{ id: 'ayrton-senna' }, { id: 'max-verstappen' }],
    constructor: [{ id: 'mclaren' }, { id: 'red-bull' }],
    race: [
      { id: 470, year: 1988 },
      { id: 1100, year: 2024 },
    ],
    race_data: [result(470, 1, 'ayrton-senna', 'mclaren'), result(1100, 1, 'max-verstappen', 'red-bull')],
    season_driver_standing: [
      { year: 1988, position_number: 1, driver_id: 'ayrton-senna' },
      { year: 2024, position_number: 1, driver_id: 'max-verstappen' },
    ],
  };

  it('corridas, resultados e campeonatos só dos anos pedidos; cadastros inteiros', () => {
    const s = sliceF1dbSeasons(release, 1980, 1989);
    expect(s.race).toEqual([{ id: 470, year: 1988 }]);
    expect(s.race_data!.map((r) => r.race_id)).toEqual([470]);
    expect(s.season_driver_standing!.map((r) => r.year)).toEqual([1988]);
    expect(s.driver).toHaveLength(2);
    expect(Object.hasOwn(s, 'constructor') && s.constructor).toHaveLength(2);
    expect(f1dbSeasonRange(release)).toEqual({ from: 1988, to: 2024 });
  });
});
