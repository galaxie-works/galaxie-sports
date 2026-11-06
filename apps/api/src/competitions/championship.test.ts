import { describe, expect, it } from 'vitest';
import { rankLeaders, titleRanking } from './championship.js';

const row = (
  person_name: string,
  n: Partial<Record<'goals' | 'assists' | 'yellow_cards' | 'red_cards' | 'minutes', number>>,
) => ({
  person_name,
  goals: 0,
  assists: 0,
  yellow_cards: 0,
  red_cards: 0,
  minutes: 900,
  ...n,
});

describe('rankLeaders', () => {
  it('maior número primeiro, empate divide a posição (menos minutos e depois o nome desempatam a ordem)', () => {
    const out = rankLeaders(
      [
        row('Zé', { goals: 5, minutes: 800 }),
        row('Ana', { goals: 5, minutes: 800 }),
        row('Bia', { goals: 9 }),
        row('Caio', { goals: 5, minutes: 400 }),
        row('Dado', { goals: 2 }),
        row('Sem gol', { goals: 0 }),
      ],
      'goals',
      10,
    );
    expect(out.map((r) => [r.rank, r.person_name])).toEqual([
      [1, 'Bia'],
      [2, 'Caio'],
      [2, 'Ana'],
      [2, 'Zé'],
      [5, 'Dado'],
    ]);
  });

  it('nome em ordem pt-BR (acento não joga para o fim)', () => {
    const out = rankLeaders(
      [row('Óscar', { assists: 1 }), row('Paulo', { assists: 1 }), row('Nilo', { assists: 1 })],
      'assists',
      3,
    );
    expect(out.map((r) => r.person_name)).toEqual(['Nilo', 'Óscar', 'Paulo']);
  });

  it('cartões: amarelos + vermelhos, os vermelhos desempatam e separam a posição', () => {
    const out = rankLeaders(
      [
        row('A', { yellow_cards: 4 }),
        row('B', { yellow_cards: 3, red_cards: 1 }),
        row('C', { yellow_cards: 2, red_cards: 2 }),
        row('D', { yellow_cards: 5 }),
      ],
      'cards',
      2,
    );
    expect(out.map((r) => [r.rank, r.person_name])).toEqual([
      [1, 'D'],
      [2, 'C'],
    ]);
  });
});

describe('titleRanking', () => {
  const rows = [
    { season_year: 2025, season_label: '2025', champion_id: 'b', champion_name: 'Beta' },
    { season_year: 2024, season_label: '2024', champion_id: 'a', champion_name: 'Alfa' },
    { season_year: 2023, season_label: '2023', champion_id: 'b', champion_name: 'Beta' },
    { season_year: 2022, season_label: '2022', champion_id: null, champion_name: null },
    { season_year: 2021, season_label: '2021', champion_id: 'a', champion_name: 'Alfa' },
    { season_year: 2020, season_label: '2020', champion_id: 'c', champion_name: 'Gama' },
  ];

  it('conta os títulos ligados; empate: o mais recente primeiro', () => {
    expect(titleRanking(rows, { first_year: 2020, latest_year: 2025, complete_through: 2025 }, 2025)).toEqual(
      [
        { teamId: 'b', titles: 2, last: '2025', lastYear: 2025 },
        { teamId: 'a', titles: 2, last: '2024', lastYear: 2024 },
        { teamId: 'c', titles: 1, last: '2020', lastYear: 2020 },
      ],
    );
  });

  it('lista incompleta ou sem cobertura: sem ranking', () => {
    expect(
      titleRanking(rows, { first_year: 2020, latest_year: 2025, complete_through: 2023 }, 2025),
    ).toBeNull();
    expect(
      titleRanking(rows, { first_year: null, latest_year: null, complete_through: null }, 2025),
    ).toBeNull();
    expect(titleRanking(rows, null, 2025)).toBeNull();
  });

  it('fonte que parou de atualizar (completa até um ano antigo): sem ranking', () => {
    expect(
      titleRanking(rows, { first_year: 2020, latest_year: 2025, complete_through: 2025 }, 2026),
    ).toBeNull();
  });
});
