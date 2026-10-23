import { describe, expect, it } from 'vitest';
import { groupCompetitions, type GroupableCompetition } from './grouping.js';

const c = (
  sport: string,
  scope: GroupableCompetition['scope'],
  name: string,
  tier = 1,
  order: number | null = null,
): GroupableCompetition => ({ sport, scope, name, tier, order });

describe('groupCompetitions', () => {
  it('agrupa por esporte (ordem da navegação) e por escopo (ordem fixa), omitindo vazios', () => {
    const out = groupCompetitions(
      [
        c('basketball', 'domestic', 'NBB'),
        c('football', 'world_clubs', 'Mundial de Clubes'),
        c('football', 'domestic', 'Brasileirão'),
        c('football', 'continental_clubs', 'Libertadores'),
        c('cricket', 'domestic', 'IPL'),
      ],
      ['football', 'basketball'],
    );
    expect(out.map((s) => s.sport)).toEqual(['football', 'basketball', 'cricket']);
    expect(out[0]!.groups.map((g) => g.scope)).toEqual(['domestic', 'continental_clubs', 'world_clubs']);
    expect(out[1]!.groups).toHaveLength(1);
  });

  it('domésticas: posição editorial antes do tier (divisões, depois copas), depois tier e nome', () => {
    const [football] = groupCompetitions(
      [
        c('football', 'domestic', 'Paulistão', 1),
        c('football', 'domestic', 'Série B', 2, 1),
        c('football', 'domestic', 'Copa do Brasil', 1, 2),
        c('football', 'domestic', 'Carioca', 1),
        c('football', 'domestic', 'Brasileirão', 1, 0),
        c('football', 'domestic', 'Série C', 2),
      ],
      ['football'],
    );
    expect(football!.groups[0]!.competitions.map((x) => x.name)).toEqual([
      'Brasileirão',
      'Série B',
      'Copa do Brasil',
      'Carioca',
      'Paulistão',
      'Série C',
    ]);
  });

  it('competições internacionais seguem a ordem do arquivo de escopo dentro do tier', () => {
    const [football] = groupCompetitions(
      [
        c('football', 'continental_clubs', 'Recopa', 1, 2),
        c('football', 'continental_clubs', 'Supercopa da UEFA', 3, 6),
        c('football', 'continental_clubs', 'Libertadores', 1, 0),
        c('football', 'continental_clubs', 'Sul-Americana', 1, 1),
      ],
      ['football'],
    );
    expect(football!.groups[0]!.competitions.map((x) => x.name)).toEqual([
      'Libertadores',
      'Sul-Americana',
      'Recopa',
      'Supercopa da UEFA',
    ]);
  });

  it('lista vazia → nenhum esporte', () => {
    expect(groupCompetitions([], ['football'])).toEqual([]);
  });
});
