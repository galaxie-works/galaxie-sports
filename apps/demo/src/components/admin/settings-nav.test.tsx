import { describe, expect, it } from 'vitest';

import { compareAlpha } from '@/lib/alphabetical';
import { LOCALES } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';

import { SETTINGS_NAV, settingsNavGroups } from './settings-nav';

describe('menu de Ajustes (#1001)', () => {
  it.each(LOCALES)(
    '%s: Clientes, Dados e Plataforma, áreas em ordem alfabética, nenhuma rota de fora',
    (locale) => {
      const groups = settingsNavGroups(getDictionary(locale).ops.nav);
      expect(groups.map((g) => g.id)).toEqual(['clients', 'data', 'platform']);
      const labels = groups.map((g) => g.label);
      expect(labels).toEqual([...labels].sort(compareAlpha));
      for (const g of groups) {
        const items = g.items.map((i) => i.label);
        expect(items).toEqual([...items].sort(compareAlpha));
      }
      expect(groups.flatMap((g) => g.items.map((i) => i.href)).sort()).toEqual(
        SETTINGS_NAV.map((i) => i.href).sort(),
      );
    },
  );
});
