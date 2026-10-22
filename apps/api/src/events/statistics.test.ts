import { TEAM_STATISTIC_CODES as CONTRACT_CODES } from '@galaxie/contracts';
import { TEAM_STATISTIC_CODES as PROVIDER_CODES } from '@galaxie/providers';
import { describe, expect, it } from 'vitest';
import { TEAM_STATISTIC_LABELS, teamStatistics } from './statistics.js';

const RAW = [
  { type: 'Ball Possession', value: '54%' },
  { type: 'Total passes', value: 549 },
  { type: 'Passes accurate', value: 483 },
  { type: 'Tackles in the air', value: 3 },
];

describe('estatísticas de time no /stats', () => {
  it('os códigos do contrato são os da normalização, e todos têm rótulo nos três idiomas', () => {
    expect([...CONTRACT_CODES]).toEqual([...PROVIDER_CODES]);
    for (const code of CONTRACT_CODES)
      expect(Object.keys(TEAM_STATISTIC_LABELS[code]).sort()).toEqual(['en', 'es', 'pt-BR']);
  });

  it('rótulo no locale pedido; sem código, o type cru', () => {
    const pt = teamStatistics(RAW, 'pt-BR');
    expect(pt[0]).toEqual({
      type: 'Ball Possession',
      value: '54%',
      code: 'possession_pct',
      label: 'Posse de bola',
      numeric: 54,
      source: 'provider',
    });
    expect(pt[3]).toMatchObject({ code: null, label: 'Tackles in the air', numeric: 3 });
    expect(pt.at(-1)).toMatchObject({ code: 'pass_accuracy_pct', label: 'Precisão de passe', numeric: 88 });
    // es-AR cai no espanhol neutro
    expect(teamStatistics(RAW, 'es-AR')[0]!.label).toBe('Posesión');
  });
});
