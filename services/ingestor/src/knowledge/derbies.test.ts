import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { teamMatchKey } from '../jobs/teams.js';
import { loadKnowledge, resolveDerbies, type Knowledge } from './derbies.js';

const knowledgeDir = fileURLToPath(new URL('../../../../data/knowledge', import.meta.url));

describe('loadKnowledge', () => {
  it('lê clássicos e times versionados em data/knowledge', async () => {
    const k = await loadKnowledge(knowledgeDir);
    expect(k.derbies.length).toBeGreaterThanOrEqual(80);
    expect(k.teams.get('palmeiras')?.teamId).toBe(121);
    expect(k.derbies.find((d) => d.slug === 'derby-paulista')?.teams).toEqual(['palmeiras', 'corinthians']);
    // ordenados pela intensidade (os maiores clássicos primeiro)
    expect(k.derbies[0]!.intensity).toBe(5);
  });
});

describe('resolveDerbies', () => {
  const k: Knowledge = {
    teams: new Map([
      ['palmeiras', { slug: 'palmeiras', teamId: 121, match: null }],
      ['corinthians', { slug: 'corinthians', teamId: 131, match: null }],
      ['river', { slug: 'river', teamId: null, match: { name: 'River Plate', country: 'Argentina' } }],
      ['boca', { slug: 'boca', teamId: null, match: { name: 'Boca Juniors', country: 'Argentina' } }],
      ['nacional', { slug: 'nacional', teamId: null, match: { name: 'Nacional', country: 'Uruguay' } }],
      ['penarol', { slug: 'penarol', teamId: 465, match: null }],
    ]),
    derbies: [
      { slug: 'derby-paulista', name: 'Derby Paulista', teams: ['palmeiras', 'corinthians'], intensity: 5 },
      { slug: 'superclasico', name: 'Superclásico', teams: ['boca', 'river'], intensity: 5 },
      { slug: 'clasico-uy', name: 'Clásico', teams: ['penarol', 'nacional'], intensity: 5 },
    ],
  };

  it('usa o team_id verificado e, se nulo, o nome+país das listas do raw (só com ID único)', () => {
    const index = new Map([
      [teamMatchKey('River Plate', 'Argentina'), new Set([435])],
      [teamMatchKey('Boca Juniors', 'Argentina'), new Set([451])],
      [teamMatchKey('Nacional', 'Uruguay'), new Set([1, 2])], // ambíguo: não resolve
    ]);
    const r = resolveDerbies(k, index);
    expect(r.pairs.map((p) => p.key)).toEqual(['121-131', '435-451']);
    expect(r.unresolved).toEqual([{ slug: 'clasico-uy', missing: ['nacional'] }]);
  });
});
