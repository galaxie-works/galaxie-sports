import { describe, expect, it } from 'vitest';
import { EVENT_STATUSES } from '../../event/status.js';
import {
  API_SPORTS_OTHER_SPORTS,
  API_SPORTS_SPORT_STATUS,
  mapSportStatus,
  sportStatusDetail,
} from './status.js';

describe('mapSportStatus', () => {
  it.each([
    ['basketball', 'Q3', 'live'],
    ['basketball', 'HT', 'break'],
    ['basketball', 'BT', 'break'],
    ['basketball', 'AOT', 'finished'],
    ['basketball', 'SUSP', 'suspended'],
    ['basketball', 'AWD', 'finished'],
    ['baseball', 'IN7', 'live'],
    ['baseball', 'IN11', 'live'],
    ['baseball', 'INTR', 'suspended'],
    ['hockey', 'P2', 'live'],
    ['hockey', 'PT', 'live'],
    ['hockey', 'AP', 'finished'],
    ['handball', '2H', 'live'],
    ['handball', 'ET', 'live'],
    ['rugby', 'AET', 'finished'],
    ['volleyball', 'S5', 'live'],
    ['volleyball', 'AW', 'finished'],
    ['afl', 'QT', 'break'],
    ['american-football', 'OT', 'live'],
    ['american-football', 'PST', 'postponed'],
    ['mma', 'WO', 'scheduled'],
    ['mma', 'PF', 'scheduled'],
    ['mma', 'EOR', 'break'],
    ['mma', 'LIVE', 'live'],
  ] as const)('%s %s → %s', (sport, short, expected) => {
    expect(mapSportStatus(sport, { short })).toBe(expected);
  });

  it('usa o texto longo quando o código curto falta (NFL "Final/OT", F1, NBA v2)', () => {
    expect(mapSportStatus('american-football', { short: null, long: 'Final/OT' })).toBe('finished');
    expect(mapSportStatus('formula-1', { long: 'Completed' })).toBe('finished');
    expect(mapSportStatus('formula-1', { long: 'Live' })).toBe('live');
    expect(mapSportStatus('formula-1', { long: 'Scheduled' })).toBe('scheduled');
    expect(mapSportStatus('formula-1', { long: 'Postponed' })).toBe('postponed');
    expect(mapSportStatus('formula-1', { long: 'Cancelled' })).toBe('cancelled');
    expect(mapSportStatus('nba', { short: 2, long: 'In Play' })).toBe('live');
    expect(mapSportStatus('nba', { short: 3, long: null })).toBe('finished');
  });

  it('código desconhecido → null', () => {
    expect(mapSportStatus('volleyball', { short: 'Q1' })).toBeNull();
    expect(mapSportStatus('hockey', { short: '' })).toBeNull();
  });

  it('todos os mapas usam só estados canônicos', () => {
    for (const sport of API_SPORTS_OTHER_SPORTS)
      for (const status of Object.values(API_SPORTS_SPORT_STATUS[sport]))
        expect(EVENT_STATUSES).toContain(status);
  });

  it('status_detail: código curto ou, sem ele, o texto', () => {
    expect(sportStatusDetail({ short: 'FT', long: 'Finished' })).toBe('FT');
    expect(sportStatusDetail({ short: null, long: 'Final/OT' })).toBe('Final/OT');
    expect(sportStatusDetail({})).toBeNull();
  });
});
