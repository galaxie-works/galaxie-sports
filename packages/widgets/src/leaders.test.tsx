import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { optionProps, parseWidgetOptions } from './options.js';
import { CompetitionLeaders } from './widgets/competition-leaders.js';

afterEach(cleanup);

function setup(ui: ReactNode, locale: WidgetLocale = 'pt-BR', calls: string[] = []) {
  const preview = createPreviewFetch();
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale={locale}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={(input, init) => {
        calls.push(String(input));
        return preview(input, init);
      }}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

const cells = (row: Element) => [...row.querySelectorAll('td')].map((td) => td.textContent);

describe('artilharia e líderes', () => {
  it('artilharia: posição, jogador com o time, jogos e gols; empatados dividem a posição', async () => {
    const calls: string[] = [];
    const { container } = setup(
      <CompetitionLeaders competitionId={PREVIEW_IDS.competition} limit={5} />,
      'pt-BR',
      calls,
    );
    expect(await screen.findByText('Rafael Prado')).toBeTruthy();
    expect(screen.getByText('Artilharia')).toBeTruthy();
    const rows = container.querySelectorAll('[data-gs-leaders="goals"] tbody tr');
    expect(rows).toHaveLength(5);
    expect(cells(rows[0]!)[0]).toBe('1');
    expect(cells(rows[0]!).at(-1)).toBe('14');
    // 11 gols cada: o de menos jogos vem antes, os dois em 2º
    expect(cells(rows[1]!)[0]).toBe('2');
    expect(cells(rows[2]!)[0]).toBe('2');
    expect(rows[1]!.textContent).toContain('Diego Lima');
    expect(cells(rows[3]!)[0]).toBe('4');
    expect(calls[0]).toContain('/v1/competitions/liga-exemplo/seasons/current/leaders?');
    expect(calls[0]).toContain('category=goals');
    expect(calls[0]).toContain('limit=5');
    // rodapé com a data da última atualização dos números
    expect(container.querySelector('[data-gs-updated]')?.textContent).toMatch(
      /^Atualizado em \d{2}\/\d{2}\/\d{2}$/,
    );
  });

  it('cartões: colunas de amarelos e vermelhos', async () => {
    const { container } = setup(
      <CompetitionLeaders competitionId={PREVIEW_IDS.competition} category="cards" showAppearances={false} />,
    );
    expect(await screen.findByText('Cartões')).toBeTruthy();
    const head = container.querySelectorAll('[data-gs-leaders="cards"] thead th');
    expect(head).toHaveLength(4);
    const first = container.querySelector('[data-gs-leaders="cards"] tbody tr')!;
    expect(first.textContent).toContain('Juan Herrera');
    expect(cells(first).slice(-2)).toEqual(['9', '1']);
  });

  it('assistências em espanhol, sem time e com o clube do portal em destaque', async () => {
    const { container } = setup(
      <CompetitionLeaders
        competitionId={PREVIEW_IDS.competition}
        category="assists"
        showTeam={false}
        highlightTeamId={PREVIEW_IDS.team}
      />,
      'es',
    );
    expect(await screen.findByText('Asistencias')).toBeTruthy();
    expect(container.querySelector('.gs-leader-team')).toBeNull();
    expect(container.querySelector('tbody tr')!.textContent).toContain('Bruno Teles');
  });

  it('opções: categoria, quantidade e temporada; o padrão não é salvo', () => {
    expect(
      parseWidgetOptions('competition_leaders', {
        category: 'goals',
        limit: 10,
        season: '2025',
        showPhoto: false,
      }),
    ).toEqual({ season: 2025, showPhoto: false });
    expect(parseWidgetOptions('competition_leaders', { category: 'fouls', limit: 999 })).toEqual({
      limit: 50,
    });
    expect(optionProps('competition_leaders', { category: 'cards' })).toEqual({ category: 'cards' });
  });

  it('catálogo: só futebol, com a competição obrigatória', () => {
    const entry = WIDGET_CATALOG.competition_leaders;
    expect(entry.sports).toEqual(['football']);
    expect(entry.requiredProps).toEqual(['competitionId']);
    expect(entry.name.en).toBe('Top scorers and leaders');
  });
});
