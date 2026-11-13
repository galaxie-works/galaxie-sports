import { describe, expect, it } from 'vitest';

import { compareAlpha } from '@/lib/alphabetical';
import { LOCALES } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';
import { SETTINGS_ITEMS, SOON_ITEMS, settingsNavIdOf } from '@/lib/ops/settings-items';

import { SETTINGS_NAV_GROUPS, settingsNavGroups, settingsNavPinned } from './settings-nav';

describe('menu de Ajustes (#1068)', () => {
  it('Início e 9 grupos com 45 itens: 26 que existem e 19 "Em breve", rotas únicas', () => {
    expect(SETTINGS_NAV_GROUPS).toHaveLength(9);
    expect(SETTINGS_ITEMS).toHaveLength(45);
    expect(SOON_ITEMS).toHaveLength(19);
    const hrefs = SETTINGS_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const item of SOON_ITEMS) expect(item.soon.href, item.id).toMatch(/^https:\/\/github\.com\//);
  });

  it.each(LOCALES)(
    '%s: Início no topo, grupos e itens em ordem alfabética, nenhum item de fora',
    (locale) => {
      const nav = getDictionary(locale).ops.nav;
      expect(settingsNavPinned(nav).map((i) => i.id)).toEqual(['home']);
      const groups = settingsNavGroups(nav);
      expect(groups).toHaveLength(9);
      const labels = groups.map((g) => g.label);
      expect(labels).toEqual([...labels].sort(compareAlpha));
      for (const g of groups) {
        const items = g.items.map((i) => i.label);
        expect(items, g.id).toEqual([...items].sort(compareAlpha));
        for (const label of items) expect(label.trim(), g.id).not.toBe('');
      }
      expect(groups.flatMap((g) => g.items.map((i) => i.href)).sort()).toEqual(
        SETTINGS_ITEMS.map((i) => i.href).sort(),
      );
      // os planejados aparecem apagados e com o selo; os que existem, não
      const soon = new Set<string>(SOON_ITEMS.map((i) => i.id));
      for (const leaf of groups.flatMap((g) => g.items))
        expect(Boolean(leaf.muted), leaf.id).toBe(soon.has(leaf.id));
    },
  );

  it('pt-BR: a ordem aprovada no estudo', () => {
    const groups = settingsNavGroups(getDictionary('pt-BR').ops.nav);
    expect(groups.map((g) => g.label)).toEqual([
      'Canais',
      'Clientes',
      'Comercial',
      'Conformidade',
      'Dados',
      'Engajamento',
      'Inteligência',
      'Plataforma',
      'Produtos',
    ]);
    expect(groups.find((g) => g.id === 'produtos')!.items.map((i) => i.label)).toEqual([
      'Ao vivo',
      'Grades e ofertas',
      'Lance a lance',
      'Onde assistir',
      'Pós-jogo',
      'Vídeos relacionados',
      'Widgets e Builder',
    ]);
  });

  // ordem escrita à mão (não o mesmo comparador do código): pega um sortByLabel que quebre num idioma
  it.each([
    [
      'en',
      [
        'Channels',
        'Commercial',
        'Compliance',
        'Customers',
        'Data',
        'Engagement',
        'Intelligence',
        'Platform',
        'Products',
      ],
    ],
    [
      'es-AR',
      [
        'Canales',
        'Clientes',
        'Comercial',
        'Cumplimiento',
        'Datos',
        'Inteligencia',
        'Participación',
        'Plataforma',
        'Productos',
      ],
    ],
  ] as const)('%s: a ordem dos grupos', (locale, expected) => {
    const groups = settingsNavGroups(getDictionary(locale).ops.nav);
    expect(groups.map((g) => g.label)).toEqual(expected);
  });

  it('item aceso pelo caminho, com ou sem o prefixo de idioma', () => {
    expect(settingsNavIdOf('/ajustes')).toBe('home');
    expect(settingsNavIdOf('/pt-BR/ajustes/ao-vivo')).toBe('live');
    expect(settingsNavIdOf('/ajustes/revisao/abc')).toBe('review');
    expect(settingsNavIdOf('/ajustes/apps-de-tv')).toBe('tvApps');
    expect(settingsNavIdOf('/ajustes-x')).toBeNull();
    expect(settingsNavIdOf('/times/1')).toBeNull();
    expect(settingsNavIdOf(null)).toBeNull();
  });
});
