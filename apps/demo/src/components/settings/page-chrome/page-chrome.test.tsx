// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';

import {
  ChangedFilter,
  HIGHLIGHT_MS,
  OnThisPage,
  PageChangedFilter,
  PageChromeProvider,
  useReportPageChrome,
  activeSection,
  anchorKey,
  countChanged,
  effectiveMode,
  hiddenRowsCss,
  openAncestors,
  parseChangedMode,
  showOnThisPage,
  showSetting,
  useSettingAnchor,
  type ChangedMode,
  type ChangedSource,
} from './index';

// a URL do roteador (caminho e busca), trocada nos testes para simular uma navegação
const nav = vi.hoisted(() => ({ pathname: '/ajustes/grades', search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

afterEach(cleanup);

const wrap = (ui: React.ReactNode) => (
  <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
    {ui}
  </I18nProvider>
);

const rows: ChangedSource[] = [
  { key: 'LIVE_MIN_PRIORITY', source: 'db' },
  { key: 'LIVE_POLL_INTERVAL_SECONDS', source: 'env' },
  { key: 'LIVE_FEATURED', source: 'db' },
  { key: 'LIVE_IDLE_EXIT_MINUTES', source: 'default' },
];

describe('Alterados no painel', () => {
  it('conta só o que veio do painel (não o .env nem o padrão)', () => {
    expect(countChanged(rows)).toBe(2);
    expect(countChanged(rows, ['LIVE_FEATURED', 'LIVE_IDLE_EXIT_MINUTES'])).toBe(1);
    expect(countChanged(rows.filter((r) => r.source !== 'db'))).toBe(0);
  });

  it('filtra as linhas e volta a "Todos" sem nenhuma alterada', () => {
    expect(rows.filter((r) => showSetting(r, 'changed')).map((r) => r.key)).toEqual([
      'LIVE_MIN_PRIORITY',
      'LIVE_FEATURED',
    ]);
    expect(rows.filter((r) => showSetting(r, 'all'))).toHaveLength(4);
    expect(effectiveMode('changed', 0)).toBe('all');
    expect(effectiveMode('changed', 2)).toBe('changed');
    expect(parseChangedMode('1')).toBe('changed');
    expect(parseChangedMode(undefined)).toBe('all');
  });

  it('mostra a contagem e troca o modo', () => {
    function Harness() {
      const [mode, setMode] = useState<ChangedMode>('all');
      return (
        <>
          <ChangedFilter value={mode} onValueChange={setMode} count={2} />
          <output>{mode}</output>
        </>
      );
    }
    render(wrap(<Harness />));
    fireEvent.click(screen.getByText('Alterados no painel (2)'));
    expect(screen.getByText('changed')).toBeTruthy();
  });

  it('fica desabilitado com "Nenhum alterado"', () => {
    render(wrap(<ChangedFilter value="all" onValueChange={() => {}} count={0} />));
    const none = screen.getByText('Nenhum alterado').closest('button')!;
    expect(none.hasAttribute('disabled') || none.hasAttribute('data-disabled')).toBe(true);
  });
});

describe('Alterados no painel na página', () => {
  function Content({ settings }: { settings: ChangedSource[] }) {
    useReportPageChrome({ updatedAt: '2026-11-11T12:00:00Z', timeZone: 'UTC', settings });
    return null;
  }

  it('o conteúdo conta as linhas; o filtro esconde as que vêm do .env ou do padrão', () => {
    const { container } = render(
      wrap(
        <PageChromeProvider>
          <PageChangedFilter />
          <Content settings={rows} />
        </PageChromeProvider>,
      ),
    );
    expect(container.querySelector('style')).toBeNull();
    fireEvent.click(screen.getByText('Alterados no painel (2)'));
    const css = container.querySelector('style')!.textContent!;
    expect(css).toContain('#LIVE_POLL_INTERVAL_SECONDS');
    expect(css).toContain('#LIVE_IDLE_EXIT_MINUTES');
    expect(css).not.toContain('#LIVE_FEATURED');
  });

  it('sem linhas de ajuste na página, nada de filtro', () => {
    const { container } = render(
      wrap(
        <PageChromeProvider>
          <PageChangedFilter />
          <Content settings={[]} />
        </PageChromeProvider>,
      ),
    );
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(screen.queryByText('Todos')).toBeNull();
  });
});

describe('Nesta página', () => {
  it('só aparece com 2+ seções', () => {
    expect(showOnThisPage([{ id: 'a', label: 'A' }])).toBe(false);
    expect(
      showOnThisPage([
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ]),
    ).toBe(true);
    const { container } = render(wrap(<OnThisPage sections={[{ id: 'a', label: 'A' }]} />));
    expect(container.querySelector('nav')).toBeNull();
  });

  it('fica escondido abaixo de xl', () => {
    render(
      wrap(
        <OnThisPage
          sections={[
            { id: 'a', label: 'Acompanhamento' },
            { id: 'b', label: 'Cota' },
          ]}
        />,
      ),
    );
    const nav = screen.getByRole('navigation', { name: 'Nesta página' });
    expect(nav.className).toContain('hidden');
    expect(nav.className).toContain('xl:block');
  });

  it('acende a última seção que passou da linha de leitura', () => {
    const tops = [
      { id: 'a', top: -400 },
      { id: 'b', top: 120 },
      { id: 'c', top: 900 },
    ];
    expect(activeSection(tops, 300)).toBe('b');
    expect(
      activeSection(
        [
          { id: 'a', top: 500 },
          { id: 'b', top: 900 },
        ],
        300,
      ),
    ).toBe('a');
  });
});

describe('chegada pela âncora', () => {
  it('lê só chaves do registro', () => {
    expect(anchorKey('#AI_DAILY_USD_BUDGET')).toBe('AI_DAILY_USD_BUDGET');
    expect(anchorKey('#acompanhamento')).toBeNull();
    expect(anchorKey('')).toBeNull();
  });

  it('âncora mal formada não derruba a página', () => {
    expect(() => anchorKey('#%')).not.toThrow();
    expect(anchorKey('#%')).toBeNull();
    expect(anchorKey('#%E0%A4%A')).toBeNull();
    expect(anchorKey('#LIVE%5FFEATURED')).toBe('LIVE_FEATURED');
  });

  it('abre o <details> fechado que contém a linha', () => {
    document.body.innerHTML = '<details><summary>x</summary><div id="LIVE_FEATURED"></div></details>';
    expect(openAncestors(document.getElementById('LIVE_FEATURED')!)).toBe(true);
    expect(document.querySelector('details')!.open).toBe(true);
  });

  it('rola, destaca por 2 s e tira o destaque', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="LIVE_FEATURED"></div>';
    const row = document.getElementById('LIVE_FEATURED')!;
    row.scrollIntoView = vi.fn();
    window.location.hash = '#LIVE_FEATURED';
    function Page() {
      useSettingAnchor();
      return null;
    }
    render(<Page />);
    act(() => vi.advanceTimersByTime(50));
    expect(row.classList.contains('bg-primary/5')).toBe(true);
    expect(row.classList.contains('transition-colors')).toBe(true);
    act(() => vi.advanceTimersByTime(HIGHLIGHT_MS));
    expect(row.classList.contains('bg-primary/5')).toBe(false);
    window.location.hash = '';
    vi.useRealTimers();
  });

  it('com #% na URL a página monta sem erro', () => {
    window.location.hash = '#%';
    function Page() {
      useSettingAnchor();
      return <p>ok</p>;
    }
    expect(() => render(<Page />)).not.toThrow();
    expect(screen.getByText('ok')).toBeTruthy();
    window.location.hash = '';
  });

  it('na mesma página, o hashchange leva à nova linha', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="LIVE_FEATURED"></div><div id="LIVE_MIN_PRIORITY"></div>';
    const second = document.getElementById('LIVE_MIN_PRIORITY')!;
    second.scrollIntoView = vi.fn();
    function Page() {
      useSettingAnchor();
      return null;
    }
    render(<Page />);
    act(() => {
      window.location.hash = '#LIVE_MIN_PRIORITY';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    act(() => vi.advanceTimersByTime(50));
    expect(second.hasAttribute('data-highlighted')).toBe(true);
    window.location.hash = '';
    vi.useRealTimers();
  });

  it('depois de uma navegação que muda a busca (?aba=ajustes), lê o hash novo sem remontar', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="LINEUP_PROMPT_MAX_CHARS"></div>';
    const row = document.getElementById('LINEUP_PROMPT_MAX_CHARS')!;
    row.scrollIntoView = vi.fn();
    nav.search = '';
    window.location.hash = '';
    function Page() {
      useSettingAnchor();
      return null;
    }
    const { rerender } = render(<Page />);
    act(() => vi.advanceTimersByTime(50));
    expect(row.hasAttribute('data-highlighted')).toBe(false);
    // o roteador grava a URL nova (sem hashchange) e a página re-renderiza com a busca nova
    window.location.hash = '#LINEUP_PROMPT_MAX_CHARS';
    nav.search = 'aba=ajustes';
    rerender(<Page />);
    act(() => vi.advanceTimersByTime(50));
    expect(row.hasAttribute('data-highlighted')).toBe(true);
    nav.search = '';
    window.location.hash = '';
    vi.useRealTimers();
  });
});

describe('"Alterados" esconde as linhas com seletor seguro', () => {
  it('escapa as chaves', () => {
    expect(hiddenRowsCss(['LIVE_FEATURED', 'A'])).toBe('#LIVE_FEATURED,#A{display:none}');
    const css = hiddenRowsCss(['X{}body{display:none']);
    expect(css).not.toContain('X{}body');
    expect(hiddenRowsCss([])).toBeNull();
  });
});

describe('Nesta página com seções que chegam depois', () => {
  it('liga o observador quando as seções aparecem (Suspense)', async () => {
    const observed: Element[] = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
    document.body.innerHTML = '';
    render(
      wrap(
        <OnThisPage
          sections={[
            { id: 'late-a', label: 'A' },
            { id: 'late-b', label: 'B' },
          ]}
        />,
      ),
    );
    expect(observed).toHaveLength(0);
    await act(async () => {
      const box = document.createElement('div');
      box.innerHTML = '<section id="late-a"></section><section id="late-b"></section>';
      document.body.appendChild(box);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(observed.map((el) => el.id)).toEqual(['late-a', 'late-b']);
    globalThis.IntersectionObserver = original;
  });
});
