import { describe, expect, it } from 'vitest';
import { deriveNameHistory, formerNamesOf, sameName, type NameObservation } from './name-history.js';

const obs = (
  name: string,
  first: string,
  last: string,
  count = 5,
  city: string | null = null,
): NameObservation => ({
  name,
  city,
  first: new Date(`${first}T20:00:00Z`),
  last: new Date(`${last}T20:00:00Z`),
  count,
});

describe('grafias do mesmo nome', () => {
  it.each([
    ['Vasco DA Gama', 'Vasco Da Gama'],
    ['Chapecoense-sc', 'Chapecoense-SC'],
    ['Estádio Nilton Santos', 'Estadio Olimpico Nilton Santos'],
    ['LSK-Hallen', 'LKS-Hallen'],
  ])('%s = %s', (a, b) => expect(sameName(a, b)).toBe(true));

  it.each([
    ['Allianz Parque', 'Nubank Parque'],
    ['Dinamo Moscow', 'Dynamo'],
    ['Czech Republic U19', 'Czechia U19'],
    ['Morumbi', 'MorumBIS'],
    ['Arena', 'Arena Corinthians'],
  ])('%s ≠ %s', (a, b) => expect(sameName(a, b)).toBe(false));
});

describe('histórico de nomes do fornecedor', () => {
  it('troca de naming rights com períodos sucessivos', () => {
    const h = deriveNameHistory([
      obs('Allianz Parque', '2016-08-31', '2025-05-22', 337),
      obs('Nubank Parque', '2026-10-09', '2026-10-24', 7),
    ]);
    expect(h).toMatchObject({ status: 'renamed', current: { name: 'Nubank Parque' } });
    expect(formerNamesOf(h)).toEqual([{ name: 'Allianz Parque', from: '2016-08-31', until: '2025-05-22' }]);
  });

  it('variações de caixa não viram nome anterior; vale a grafia mais recente', () => {
    const h = deriveNameHistory([
      obs('Vasco DA Gama', '2014-01-01', '2020-12-01', 50),
      obs('Vasco Da Gama', '2021-01-01', '2026-10-01', 40),
    ]);
    expect(h).toMatchObject({ status: 'single', current: { name: 'Vasco Da Gama', count: 90 } });
    expect(formerNamesOf(h)).toBeNull();
  });

  it('time renomeado (Dinamo Moscow → Dynamo)', () => {
    const h = deriveNameHistory([
      obs('Dinamo Moscow', '2014-08-01', '2020-07-22'),
      obs('Dynamo', '2024-07-20', '2026-10-01'),
    ]);
    expect(formerNamesOf(h)).toEqual([{ name: 'Dinamo Moscow', from: '2014-08-01', until: '2020-07-22' }]);
  });

  it('ID reaproveitado (nomes alternando ou sobrepostos) fica de fora', () => {
    const h = deriveNameHistory([
      obs('Estádio Nilton Santos', '2016-01-01', '2026-09-01', 200),
      obs('Estádio Jornalista Mário Filho', '2018-05-01', '2019-03-01', 3),
      obs('Estádio Nacional de Brasília Mané Garrincha', '2020-01-01', '2020-02-01', 1),
    ]);
    expect(h?.status).toBe('ambiguous');
    expect(formerNamesOf(h)).toBeNull();
  });

  it.each([
    [
      'casa provisória com volta ao estádio de origem',
      [
        obs('Spotify Camp Nou', '2014-08-24', '2023-05-28', 180, 'Barcelona'),
        obs('Estadi Olímpic Lluís Companys', '2023-08-20', '2025-10-01', 70, 'Barcelona'),
        obs('Spotify Camp Nou', '2025-11-22', '2026-10-18', 20, 'Barcelona'),
      ],
    ],
    [
      'nome de torneio por poucas semanas (A → B → A)',
      [
        obs('Mercedes-Benz Stadium', '2018-03-04', '2026-05-30', 120, 'Atlanta'),
        obs('Atlanta Stadium', '2026-06-15', '2026-07-15', 8, 'Atlanta'),
        obs('Mercedes-Benz Stadium', '2026-08-01', '2026-10-20', 6, 'Atlanta'),
      ],
    ],
    [
      'erro pontual do fornecedor no meio do período',
      [obs('Estádio A', '2020-01-01', '2026-10-01', 90), obs('Estádio B', '2022-03-01', '2022-04-01', 2)],
    ],
  ])('A → B → A nunca é troca de nome: %s', (_label, observations) => {
    const h = deriveNameHistory(observations);
    expect(h?.status).not.toBe('renamed');
    expect(formerNamesOf(h)).toBeNull();
  });

  it('outra cidade = ID reaproveitado, não troca de nome', () => {
    const h = deriveNameHistory([
      obs('Khalifa International Stadium', '2022-11-21', '2025-08-24', 30, 'Doha'),
      obs('Stadion Maksimir', '2026-09-01', '2026-10-22', 3, 'Zagreb'),
    ]);
    expect(h?.status).toBe('ambiguous');
  });

  it('nome visto em um jogo só é ruído (estádio provisório)', () => {
    const h = deriveNameHistory([
      obs('epet ARENA', '2021-11-16', '2025-01-22', 40, 'Praha'),
      obs('TCM Strahov', '2026-10-02', '2026-10-02', 1, 'Praha'),
    ]);
    expect(h).toMatchObject({ status: 'single', current: { name: 'epet ARENA' } });
  });

  it('transliteração e "estádio" em outra língua não são troca de nome', () => {
    expect(sameName('Yıldız Entegre Kocaeli Stadyumu', 'Yildiz Entegre Kocaeli Stadyumu')).toBe(true);
    expect(sameName('Tüpraş Stadyumu', 'Tüpraş Stadium')).toBe(true);
    expect(sameName('Jan Breydelstadion', 'Jan Breydel Stadium')).toBe(true);
    expect(sameName('Krasnodar', 'FC Krasnodar')).toBe(true);
  });

  it('sem observações', () => expect(deriveNameHistory([])).toBeNull());
});
