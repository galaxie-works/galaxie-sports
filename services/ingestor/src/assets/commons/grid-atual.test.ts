import { describe, expect, it } from 'vitest';
import type { F1dbTables } from '@galaxie/providers';
import { targetsByKey } from './load.js';
import {
  highlightSeason,
  targetKey,
  targetsFor,
  teamOf,
  type CarTarget,
  type DriverTarget,
} from './scope.js';

const all = Array.from({ length: 17 }, (_, i) => i + 1).join(';');

/** F1DB mínimo de 2026: Lawson troca de equipe no meio do ano, um reserva só de treino livre e uma lenda no grid. */
const tables: F1dbTables = {
  driver: [
    { id: 'kimi-antonelli', name: 'Kimi Antonelli', last_name: 'Antonelli', date_of_birth: '2006-08-25' },
    { id: 'george-russell', name: 'George Russell', last_name: 'Russell' },
    { id: 'liam-lawson', name: 'Liam Lawson', last_name: 'Lawson' },
    { id: 'arvid-lindblad', name: 'Arvid Lindblad', last_name: 'Lindblad' },
    { id: 'isack-hadjar', name: 'Isack Hadjar', last_name: 'Hadjar' },
    { id: 'frederik-vesti', name: 'Frederik Vesti', last_name: 'Vesti' },
    { id: 'lewis-hamilton', name: 'Lewis Hamilton', last_name: 'Hamilton', total_championship_wins: 7 },
  ],
  constructor: [
    { id: 'mercedes', name: 'Mercedes' },
    { id: 'racing-bulls', name: 'Racing Bulls' },
    { id: 'red-bull', name: 'Red Bull' },
    { id: 'ferrari', name: 'Ferrari' },
  ],
  chassis: [
    { id: 'w17', full_name: 'Mercedes F1 W17' },
    { id: 'vcarb-03', full_name: 'Racing Bulls VCARB 03' },
    { id: 'rb22', full_name: 'Red Bull Racing RB22' },
    { id: 'sf-26', full_name: 'Ferrari SF-26' },
    { id: 'w11', full_name: 'Mercedes F1 W11' },
  ],
  season_driver: [
    {
      year: 2025,
      driver_id: 'kimi-antonelli',
      total_race_wins: 0,
      total_race_starts: 24,
      position_number: 7,
    },
    {
      year: 2026,
      driver_id: 'kimi-antonelli',
      total_race_wins: 2,
      total_race_starts: 17,
      position_number: 2,
    },
    {
      year: 2026,
      driver_id: 'george-russell',
      total_race_wins: 1,
      total_race_starts: 17,
      position_number: 3,
    },
    { year: 2026, driver_id: 'liam-lawson', total_race_wins: 0, total_race_starts: 17, position_number: 14 },
    {
      year: 2026,
      driver_id: 'arvid-lindblad',
      total_race_wins: 0,
      total_race_starts: 17,
      position_number: 12,
    },
    { year: 2026, driver_id: 'isack-hadjar', total_race_wins: 0, total_race_starts: 14, position_number: 9 },
    { year: 2026, driver_id: 'frederik-vesti', total_race_wins: 0, total_race_starts: 0 },
    {
      year: 2020,
      driver_id: 'lewis-hamilton',
      total_race_wins: 11,
      total_race_starts: 16,
      position_number: 1,
    },
    {
      year: 2026,
      driver_id: 'lewis-hamilton',
      total_race_wins: 0,
      total_race_starts: 17,
      position_number: 6,
    },
  ],
  season_driver_standing: [
    { year: 2020, driver_id: 'lewis-hamilton', position_number: 1, championship_won: 1 },
    // temporada em andamento: o líder não é campeão
    { year: 2026, driver_id: 'kimi-antonelli', position_number: 1, championship_won: 0 },
  ],
  season_entrant_driver: [
    {
      year: 2025,
      constructor_id: 'mercedes',
      entrant_id: 'mercedes',
      driver_id: 'kimi-antonelli',
      test_driver: 0,
    },
    {
      year: 2026,
      constructor_id: 'mercedes',
      entrant_id: 'mercedes',
      driver_id: 'kimi-antonelli',
      test_driver: 0,
      rounds: all,
    },
    {
      year: 2026,
      constructor_id: 'mercedes',
      entrant_id: 'mercedes',
      driver_id: 'george-russell',
      test_driver: 0,
      rounds: all,
    },
    {
      year: 2026,
      constructor_id: 'mercedes',
      entrant_id: 'mercedes',
      driver_id: 'frederik-vesti',
      test_driver: 1,
    },
    {
      year: 2026,
      constructor_id: 'red-bull',
      entrant_id: 'red-bull',
      driver_id: 'liam-lawson',
      test_driver: 0,
      rounds: '12;13;14',
    },
    {
      year: 2026,
      constructor_id: 'racing-bulls',
      entrant_id: 'vcarb',
      driver_id: 'liam-lawson',
      test_driver: 0,
      rounds: '1;2;3;4;5;6;7;8;9;10;11;15;16;17',
    },
    {
      year: 2026,
      constructor_id: 'racing-bulls',
      entrant_id: 'vcarb',
      driver_id: 'arvid-lindblad',
      test_driver: 0,
      rounds: all,
    },
    {
      year: 2026,
      constructor_id: 'red-bull',
      entrant_id: 'red-bull',
      driver_id: 'isack-hadjar',
      test_driver: 0,
      rounds: '1;2;3;4;5;6;7;8;9;10;11;15;16;17',
    },
    {
      year: 2020,
      constructor_id: 'mercedes',
      entrant_id: 'mercedes',
      driver_id: 'lewis-hamilton',
      test_driver: 0,
    },
    {
      year: 2026,
      constructor_id: 'ferrari',
      entrant_id: 'ferrari',
      driver_id: 'lewis-hamilton',
      test_driver: 0,
      rounds: all,
    },
  ],
  season_entrant_chassis: [
    { year: 2026, constructor_id: 'mercedes', entrant_id: 'mercedes', chassis_id: 'w17' },
    { year: 2026, constructor_id: 'racing-bulls', entrant_id: 'vcarb', chassis_id: 'vcarb-03' },
    { year: 2026, constructor_id: 'red-bull', entrant_id: 'red-bull', chassis_id: 'rb22' },
    { year: 2026, constructor_id: 'ferrari', entrant_id: 'ferrari', chassis_id: 'sf-26' },
    { year: 2020, constructor_id: 'mercedes', entrant_id: 'mercedes', chassis_id: 'w11' },
  ],
};

describe('escopo grid-atual', () => {
  const targets = targetsFor(tables, 'grid-atual');
  const keys = targets.map(targetKey);

  it('todo piloto que largou na última temporada, o carro de cada equipe e o carro de destaque', () => {
    expect(keys).toEqual([
      'driver/arvid-lindblad',
      'driver/george-russell',
      'driver/isack-hadjar',
      'driver/kimi-antonelli',
      'driver/lewis-hamilton',
      'driver/liam-lawson',
      'car/ferrari/2026',
      'car/mercedes/2026',
      'car/racing-bulls/2026',
      'car/red-bull/2026',
      // Hamilton: o título de 2020 continua o destaque dele; os outros caem num carro de 2026, já na lista
      'car/mercedes/2020',
    ]);
    // o reserva só de treino livre (sem largada) fica de fora
    expect(keys).not.toContain('driver/frederik-vesti');
  });

  it('o carro da equipe vale pelos dois pilotos (sem piloto de destaque)', () => {
    const car = targets.find((t) => targetKey(t) === 'car/mercedes/2026') as CarTarget;
    expect(car.chassis).toEqual(['Mercedes F1 W17']);
    expect(car.driver).toBeUndefined();
  });

  it('o piloto leva as temporadas (época das fotos) e o carro de destaque pela mesma regra das lendas', () => {
    const kimi = targets.find((t) => targetKey(t) === 'driver/kimi-antonelli') as DriverTarget;
    expect(kimi.seasons).toEqual([2025, 2026]);
    expect(kimi.highlight).toMatchObject({ target: 'car/mercedes/2026', year: 2026 });
    const lewis = targets.find((t) => targetKey(t) === 'driver/lewis-hamilton') as DriverTarget;
    // no grid, a temporada atual vem primeiro (o heading mostra a equipe de hoje); o título fica de candidato
    expect(lewis.highlight?.target).toBe('car/ferrari/2026');
    expect(lewis.fallbacks?.map((h) => h.target)).toEqual(['car/mercedes/2020']);
    expect(highlightSeason(tables, 'lewis-hamilton')?.target).toBe('car/ferrari/2026');
  });

  it('a equipe atual é a de mais rodadas no ano (Lawson: Racing Bulls, não a Red Bull de 3 corridas)', () => {
    expect(teamOf(tables, 'liam-lawson', 2026)).toEqual({ constructorId: 'racing-bulls', entrant: 'vcarb' });
    expect(teamOf(tables, 'frederik-vesti', 2026)).toBeNull();
    const lawson = targets.find((t) => targetKey(t) === 'driver/liam-lawson') as DriverTarget;
    expect(lawson.highlight?.target).toBe('car/racing-bulls/2026');
  });

  it('outra temporada com o ano pedido', () => {
    expect(targetsFor(tables, 'grid-atual', 30, 2020).map(targetKey)).toEqual([
      'driver/lewis-hamilton',
      'car/mercedes/2020',
      // candidato a destaque: a temporada atual dele, na Ferrari
      'car/ferrari/2026',
    ]);
  });

  it('a ordem do Gemini acha os alvos do grid pelas chaves', () => {
    expect(targetsByKey(tables, ['car/racing-bulls/2026', 'driver/arvid-lindblad']).map(targetKey)).toEqual([
      'car/racing-bulls/2026',
      'driver/arvid-lindblad',
    ]);
  });
});
