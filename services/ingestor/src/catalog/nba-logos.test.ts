import { describe, expect, it } from 'vitest';
import { matchNbaLogos, teamKey } from './nba-logos.js';

describe('logos da NBA v2 a partir do api-basketball', () => {
  it('casa pelo nome (com apelidos e apóstrofos); ambíguo desempata por quem jogou a NBA', () => {
    expect(teamKey('LA Clippers')).toBe('los angeles clippers');
    expect(teamKey('Shaq’s  OGs')).toBe('shaqs ogs');
    const out = matchNbaLogos(
      [
        { id: 'n1', name: 'LA Clippers' },
        { id: 'n2', name: 'Boston Celtics' },
        { id: 'n3', name: 'Miami Heat' },
        { id: 'n4', name: 'Team Sem Par' },
      ],
      [
        { name: 'Los Angeles Clippers', logoAssetId: 'a1', inNba: true },
        { name: 'Boston Celtics', logoAssetId: 'a2', inNba: false },
        { name: 'Miami Heat', logoAssetId: 'a3', inNba: false },
        { name: 'Miami Heat', logoAssetId: 'a4', inNba: true },
      ],
    );
    expect(Object.fromEntries(out)).toEqual({ n1: 'a1', n2: 'a2', n3: 'a4' });
  });

  it('nome repetido sem time da NBA entre os candidatos fica sem logo', () => {
    const out = matchNbaLogos(
      [{ id: 'n1', name: 'Kings' }],
      [
        { name: 'Kings', logoAssetId: 'a1', inNba: false },
        { name: 'Kings', logoAssetId: 'a2', inNba: false },
      ],
    );
    expect(out.size).toBe(0);
  });
});
