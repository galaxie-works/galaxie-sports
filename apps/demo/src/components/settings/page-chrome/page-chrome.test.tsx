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
  activeSection,
  anchorKey,
  countChanged,
  effectiveMode,
  openAncestors,
  parseChangedMode,
  showOnThisPage,
  showSetting,
  useSettingAnchor,
  type ChangedMode,
  type ChangedSource,
} from './index';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

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
});
