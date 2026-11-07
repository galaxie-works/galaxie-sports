import { RAW_CADENCE } from '@galaxie/observability';
import { DEFAULT_MIRROR_CONFIG } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';
import { OTHER_SPORTS_SCHEDULE, ROTATION_PERIOD_DAYS } from './daily-job.js';
import { FOOTBALL_REFERENCE, FOOTBALL_SEASON_ENDPOINTS } from './mirror-job.js';

/**
 * O mapa de frescor (alerta RawEndpointOverdue, docs/03 §11.1) tem que andar junto com os períodos que os jobs
 * usam de verdade: período maior no mapa esconde o atraso; menor dispara alerta falso todo dia.
 */
const cadence = (sport: string, endpoint: string) =>
  RAW_CADENCE.find((c) => c.sport === sport && c.endpoint === endpoint);

describe('mapa de frescor × períodos dos jobs', () => {
  it('rodízio de pessoas do sync diário', () => {
    for (const [endpoint, days] of Object.entries(ROTATION_PERIOD_DAYS))
      expect(cadence('football', endpoint), endpoint).toMatchObject({ periodDays: days, job: 'sync:daily' });
  });

  it('temporada em jogo no espelho: o período do tier 1 do catálogo (runtime-config)', () => {
    const football = DEFAULT_MIRROR_CONFIG.api('football');
    for (const e of FOOTBALL_SEASON_ENDPOINTS) {
      const c = cadence('football', e.endpoint);
      expect(c, e.endpoint).toBeDefined();
      // /injuries: o sync diário busca o do dia (1 dia) e o espelho, o da temporada
      expect(c!.periodDays, e.endpoint).toBe(football.period(e.endpoint, 1));
    }
  });

  it('referência do futebol a cada 7 dias', () => {
    for (const e of FOOTBALL_REFERENCE)
      expect(cadence('football', e), e).toMatchObject({ periodDays: 7, job: 'sync:mirror' });
  });

  it('agenda diária das outras 11 APIs', () => {
    for (const [sport, endpoint] of Object.entries(OTHER_SPORTS_SCHEDULE))
      expect(cadence(sport, endpoint), sport).toMatchObject({ periodDays: 1, job: 'sync:daily' });
  });

  it('nenhum endpoint repetido', () => {
    const keys = RAW_CADENCE.map((c) => `${c.sport} ${c.endpoint}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
