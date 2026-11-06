import { describe, expect, it } from 'vitest';
import { editionsOf, rankChampions, rankingComplete, runnerUpOf, type TitleRow } from './champions.js';

const t = (year: number, team: string | null, qid = `Q${year}`): TitleRow => ({
  seasonYear: year,
  seasonLabel: String(year),
  decidedOn: `${year}-12-01`,
  editionQid: qid,
  participantId: team,
});

describe('editionsOf', () => {
  it('ordena da mais recente para trás e tira a edição repetida', () => {
    const out = editionsOf([t(2019, 'fla'), t(2021, 'pal'), t(2020, 'pal'), t(2021, 'pal')]);
    expect(out.map((e) => e.seasonYear)).toEqual([2021, 2020, 2019]);
  });
});

describe('rankingComplete', () => {
  const eds = [t(2022, 'pal'), t(2023, 'pal')];
  it('vale com a cobertura sem lacuna até a última edição', () => {
    expect(rankingComplete(eds, { firstYear: 1959, completeThrough: 2023 })).toBe(true);
  });
  it('não vale com lacuna antes da última edição, sem cobertura ou sem edições', () => {
    expect(rankingComplete(eds, { firstYear: 1959, completeThrough: 2020 })).toBe(false);
    expect(rankingComplete(eds, null)).toBe(false);
    expect(rankingComplete([], { firstYear: 1959, completeThrough: 2023 })).toBe(false);
  });
});

describe('rankChampions', () => {
  const names: Record<string, string> = {
    pal: 'Palmeiras',
    fla: 'Flamengo',
    sao: 'São Paulo',
    cor: 'Corinthians',
  };
  const nameOf = (id: string) => names[id] ?? id;

  it('mais títulos primeiro, depois o mais recente, e o vencedor fora do catálogo não entra', () => {
    const eds = editionsOf([
      t(2018, 'pal'),
      t(2019, 'fla'),
      t(2020, 'fla'),
      t(2022, 'pal'),
      t(2023, 'pal'),
      t(1990, null),
    ]);
    const r = rankChampions(eds, nameOf);
    expect(r.map((x) => [x.rank, x.participantId, x.titles])).toEqual([
      [1, 'pal', 3],
      [2, 'fla', 2],
    ]);
    expect(r[0]!.seasons).toEqual(['2023', '2022', '2018']);
  });

  it('empate em títulos e no título mais recente divide a posição, em ordem alfabética', () => {
    const eds = [
      { ...t(2005, 'sao', 'Q1'), decidedOn: '2005-12-01' },
      { ...t(2005, 'cor', 'Q2'), decidedOn: '2005-12-01' },
      t(2001, 'fla'),
    ];
    const r = rankChampions(eds, nameOf);
    expect(r.map((x) => [x.rank, x.participantId])).toEqual([
      [1, 'cor'],
      [1, 'sao'],
      [3, 'fla'],
    ]);
  });
});

describe('runnerUpOf', () => {
  it('o outro finalista quando a final teve dois times e o campeão é um deles', () => {
    expect(runnerUpOf('pal', { participants: ['pal', 'fla', 'fla', 'pal'] }, undefined)).toBe('fla');
    expect(runnerUpOf('pal', { participants: ['sao', 'fla'] }, undefined)).toBeNull();
    expect(runnerUpOf('pal', { participants: ['pal', 'fla', 'sao'] }, undefined)).toBeNull();
  });

  it('sem final, o 2º da tabela única quando o 1º é o campeão', () => {
    expect(runnerUpOf('pal', undefined, { groups: 1, first: 'pal', second: 'fla' })).toBe('fla');
    expect(runnerUpOf('pal', undefined, { groups: 1, first: 'fla', second: 'pal' })).toBeNull();
    expect(runnerUpOf('pal', undefined, { groups: 2, first: 'pal', second: 'fla' })).toBeNull();
    expect(runnerUpOf(null, undefined, { groups: 1, first: 'pal', second: 'fla' })).toBeNull();
    expect(runnerUpOf('pal', undefined, undefined)).toBeNull();
  });
});
