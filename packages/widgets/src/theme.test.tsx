import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THEMES,
  THEME_PRESET_IDS,
  WIDGET_CSS,
  readableOn,
  textsFor,
  themeToCssVars,
} from './core/model.js';
import { EmptyState, GalaxieWidgetProvider, WidgetFrame } from './core/react.js';
import { LiveChat } from './widgets/live-chat.js';

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
    // primária translúcida: decide pela mistura com o fundo
    expect(readableOn('#1d4ed8', '#ffffff')).toBe('#ffffff');
    expect(readableOn('#1d4ed820', '#ffffff')).toBe('#0b0d12');
    expect(readableOn('#1d4ed820', '#0b0d12')).toBe('#ffffff');
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

describe('estados de erro e vazio seguem o tema (#1389)', () => {
  const dark = DEFAULT_THEMES.dark;
  const FIXTURE = '0190f000-0000-7000-8000-00000000f001';

  /** Declarações de uma regra da folha dos widgets (a primeira com esse seletor). */
  const rule = (selector: string) => {
    const at = WIDGET_CSS.indexOf(`\n${selector}{`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    const start = at + selector.length + 2;
    return WIDGET_CSS.slice(start, WIDGET_CSS.indexOf('}', start));
  };

  it('a sala recusada (403) no tema escuro: o erro fica no card, com as cores do tema e sem fundo próprio', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes(`/v1/chat/rooms/${FIXTURE}`)
        ? new Response(JSON.stringify({ title: 'Plano não inclui o módulo live_chat' }), { status: 403 })
        : new Response('{}', { status: 401 }),
    );
    render(
      <GalaxieWidgetProvider
        baseUrl="https://api.exemplo.test"
        publishableKey="gs_pk_test_site"
        theme={dark}
        locale="pt-BR"
        fetch={fetchImpl as unknown as typeof fetch}
      >
        <LiveChat eventId={FIXTURE} />
      </GalaxieWidgetProvider>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(textsFor('pt-BR').forbidden);
    expect(alert.className).toBe('gs-state');
    expect(alert.getAttribute('style')).toBeNull();
    // o fundo é o do card (--gs-surface do tema), dentro da raiz com as variables do tema escuro
    const card = alert.closest<HTMLElement>('.gs-card');
    expect(card?.dataset.gsWidget).toBe('live_chat');
    const root = alert.closest<HTMLElement>('.gs-root')!;
    expect(root.dataset.gsMode).toBe('dark');
    expect(root.style.getPropertyValue('--gs-surface')).toBe(dark.surface);
    expect(root.style.getPropertyValue('--gs-muted-foreground')).toBe(dark.mutedForeground);
  });

  it('o vazio também mora no card do tema escuro', () => {
    render(
      <GalaxieWidgetProvider baseUrl="https://api.exemplo.test" theme={dark} locale="pt-BR">
        <WidgetFrame kind="live_list">
          <EmptyState>nada hoje</EmptyState>
        </WidgetFrame>
      </GalaxieWidgetProvider>,
    );
    const empty = screen.getByText('nada hoje');
    expect(empty.className).toBe('gs-state');
    expect(empty.closest('.gs-root')?.getAttribute('data-gs-mode')).toBe('dark');
  });

  it('card, estado e botão de tentar de novo só usam as variables do tema (nenhuma cor fixa)', () => {
    for (const selector of ['.gs-root', '.gs-card', '.gs-state', '.gs-button']) {
      const colors = rule(selector)
        .split(';')
        .filter((d) => /^(color|background|background-color|border|border-color)\s*:/.test(d));
      for (const d of colors)
        expect(d, `${selector} → ${d}`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|\bwhite\b/i);
    }
    expect(rule('.gs-card')).toContain('background:var(--gs-surface)');
    expect(rule('.gs-state')).toContain('color:var(--gs-muted-foreground)');
    expect(rule('.gs-state')).not.toContain('background');
  });
});
