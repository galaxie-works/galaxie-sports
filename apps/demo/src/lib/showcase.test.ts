import { loadKnowledge } from '@galaxie/knowledge';
import { describe, expect, it } from 'vitest';

import { LOCALES } from './i18n/config';
import { showcase } from './showcase';

describe('vitrine pública (/sobre)', () => {
  it('histórico geral só de par aprovado na base semântica (a API retém o rascunho)', async () => {
    const kb = await loadKnowledge();
    for (const locale of LOCALES) {
      const all = showcase(locale).h2h.allTime;
      if (!all) continue;
      const pair = kb.headToHead.find((p) => p.entry.slug === all.pair);
      expect(pair, `par ${all.pair} na base semântica`).toBeDefined();
      expect(pair!.entry.all_time.review_status, `histórico de ${all.pair}`).toBe('approved');
    }
  });
});
