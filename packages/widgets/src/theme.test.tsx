import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_THEMES, THEME_PRESET_IDS, readableOn, themeToCssVars } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';

afterEach(cleanup);

describe('themeToCssVars', () => {
  it('converte o tema nas variables --gs-*', () => {
    const vars = themeToCssVars(DEFAULT_THEMES.dark);
    expect(vars).toMatchObject({
      '--gs-primary': DEFAULT_THEMES.dark.primary,
      '--gs-background': DEFAULT_THEMES.dark.background,
      '--gs-surface': DEFAULT_THEMES.dark.surface,
      '--gs-foreground': DEFAULT_THEMES.dark.foreground,
      '--gs-muted-foreground': DEFAULT_THEMES.dark.mutedForeground,
      '--gs-border': DEFAULT_THEMES.dark.border,
      '--gs-radius': '12px',
      '--gs-font-family': DEFAULT_THEMES.dark.fontFamily,
      '--gs-gap': '12px',
    });
    expect(Object.keys(vars).every((k) => k.startsWith('--gs-'))).toBe(true);
  });

  it('densidade compacta aperta espaçamentos e o raio fica entre 0 e 32 px', () => {
    const vars = themeToCssVars({ ...DEFAULT_THEMES.light, density: 'compact', radius: 99 });
    expect(vars['--gs-gap']).toBe('8px');
    expect(vars['--gs-font-size']).toBe('13px');
    expect(vars['--gs-radius']).toBe('32px');
    expect(themeToCssVars({ ...DEFAULT_THEMES.light, radius: -4 })['--gs-radius']).toBe('0px');
  });

  it('escolhe o texto legível sobre a cor primária', () => {
    expect(readableOn('#ffd400')).toBe('#0b0d12');
    expect(readableOn('#1d4ed8')).toBe('#ffffff');
    expect(readableOn('#fff')).toBe('#0b0d12');
    expect(readableOn('oklch(0.6 0.2 250)')).toBe('#ffffff');
  });

  it('tem os presets escuro, claro e dois de marca', () => {
    expect(THEME_PRESET_IDS).toEqual(['dark', 'light', 'emerald', 'sunset']);
    expect(DEFAULT_THEMES.dark.mode).toBe('dark');
    expect(DEFAULT_THEMES.light.mode).toBe('light');
  });
});

describe('GalaxieWidgetProvider', () => {
  it('aplica o tema como CSS variables na raiz .gs-root', () => {
    const { container } = render(
      <GalaxieWidgetProvider
        baseUrl="https://api.exemplo.test"
        publishableKey="pk"
        theme={DEFAULT_THEMES.sunset}
        locale="pt-BR"
        className="minha-classe"
      >
        <span>oi</span>
      </GalaxieWidgetProvider>,
    );
    const root = container.querySelector<HTMLElement>('.gs-root')!;
    expect(root.className).toBe('gs-root minha-classe');
    expect(root.dataset.gsMode).toBe('light');
    expect(root.style.getPropertyValue('--gs-primary')).toBe(DEFAULT_THEMES.sunset.primary);
    expect(root.style.getPropertyValue('--gs-radius')).toBe('18px');
    expect(root.querySelector('style')?.textContent).toContain('.gs-card');
  });
});
