import { describe, expect, it } from 'vitest';
import { sessionName } from './events/race.js';
import { TEAM_STATISTIC_LABELS } from './events/statistics.js';
import { RELATED_TYPE_LABELS } from './routes/v1/related.js';
import { sidelinedReasonLabel } from './sidelined/classify.js';

/**
 * Guarda dos mapas de tradução (#1426, épico #634): o tipo já obriga `en`; aqui confere que o texto em inglês
 * não é português copiado.
 */
const PORTUGUESE = /[áéíóúãõçâêôà]/i;

describe('mapas de tradução da API', () => {
  it('estatísticas de time têm en em inglês', () => {
    for (const [code, t] of Object.entries(TEAM_STATISTIC_LABELS)) expect(t.en, code).not.toMatch(PORTUGUESE);
  });

  it('tipos de conteúdo relacionado têm en em inglês', () => {
    for (const [code, t] of Object.entries(RELATED_TYPE_LABELS.en)) expect(t, code).not.toMatch(PORTUGUESE);
  });

  it('desfalques e sessões da F1 têm en em inglês', () => {
    for (const r of ['injury', 'knee injury', 'red card', 'illness', 'suspended'])
      expect(sidelinedReasonLabel(r, 'en'), r).not.toMatch(PORTUGUESE);
    for (const t of ['practice', 'qualifying', 'sprint_qualifying', 'sprint', 'race'] as const)
      expect(sessionName(t, null, 'en'), t).not.toMatch(PORTUGUESE);
  });
});
