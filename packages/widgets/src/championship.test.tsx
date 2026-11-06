import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { DERBY_COUNTRIES, WIDGET_OPTIONS, parseWidgetOptions } from './options.js';
import { Champions } from './widgets/champions.js';
import { CompetitionLeaders } from './widgets/competition-leaders.js';
import { DerbyWeek } from './widgets/derby-week.js';

afterEach(cleanup);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(ui: ReactNode, opts: { fetch?: typeof fetch; locale?: WidgetLocale } = {}) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale={opts.locale ?? 'pt-BR'}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={opts.fetch ?? createPreviewFetch()}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

const cells = (row: Element) => [...row.querySelectorAll('td')].map((td) => td.textContent);

describe('clássicos da semana', () => {
  it('o clássico com data, escudos, histórico e onde assistir', async () => {
    const { container } = setup(<DerbyWeek />);
    expect(await screen.findByText('Clássico da Serra')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('[data-gs-history=all_time]')).toBeTruthy());
    expect(container.querySelector('[data-gs-history]')!.textContent).toBe(
      'Histórico: 214 jogos · Atlético Serra 82 · Empates 61 · União Litoral 71',
    );
    await waitFor(() => expect(container.querySelector('[data-gs-watch]')).toBeTruthy());
    expect(container.querySelectorAll('.gs-derby-teams img')).toHaveLength(2);
  });

  it('sem histórico nem onde assistir quando desligados (nada de chamada a mais)', async () => {
    const calls: string[] = [];
    const base = createPreviewFetch();
    const spy: typeof fetch = (input, init) => {
      calls.push(String(input));
      return base(input, init);
    };
    setup(<DerbyWeek showHistory={false} showWhereToWatch={false} country="BR" days={3} />, { fetch: spy });
    expect(await screen.findByText('Clássico da Serra')).toBeTruthy();
    expect(
      calls.some(
        (c) => c.includes('/v1/derbies/upcoming?') && c.includes('country=BR') && c.includes('days=3'),
      ),
    ).toBe(true);
    expect(calls.some((c) => /\/v1\/derbies\/[^/?]+\?/.test(c) && !c.includes('upcoming'))).toBe(false);
    expect(calls.some((c) => c.includes('where-to-watch'))).toBe(false);
  });

  it('país "todos" não filtra; semana sem clássico mostra o estado vazio', async () => {
    const calls: string[] = [];
    const empty: typeof fetch = async (input) => {
      calls.push(String(input));
      return json({ data: [] });
    };
    setup(<DerbyWeek country="all" />, { fetch: empty, locale: 'es' });
    expect(await screen.findByText('Ningún clásico en los próximos días.')).toBeTruthy();
    expect(calls[0]).not.toContain('country=');
  });
});

describe('artilharia e líderes', () => {
  it('artilharia: posição dividida no empate, foto, time e gols', async () => {
    const { container } = setup(<CompetitionLeaders competitionId={PREVIEW_IDS.competition} limit={4} />);
    expect(await screen.findByText('Rafael Lima')).toBeTruthy();
    const rows = [...container.querySelectorAll('[data-gs-leaders=goals] tbody tr')];
    expect(rows).toHaveLength(4);
    // dois com 11 gols dividem o 2º lugar: a posição só aparece no primeiro
    expect(rows.map((r) => cells(r)[0])).toEqual(['1', '2', '', '4']);
    expect(cells(rows[0]!).at(-1)).toBe('14');
    expect(screen.getByText('Artilharia')).toBeTruthy();
    expect(screen.getByText('Atualizado em 05/11/26')).toBeTruthy();
  });

  it('cartões: amarelos e vermelhos, com os vermelhos desempatando', async () => {
    const { container } = setup(
      <CompetitionLeaders competitionId={PREVIEW_IDS.competition} category="cards" limit={3} />,
      { locale: 'en' },
    );
    expect(await screen.findByText('Cards')).toBeTruthy();
    const rows = [...container.querySelectorAll('[data-gs-leaders=cards] tbody tr')];
    expect(rows.map((r) => cells(r).slice(-2))).toEqual([
      ['8', '1'],
      ['4', '2'],
      ['5', '1'],
    ]);
    expect([...container.querySelectorAll('thead abbr')].map((a) => a.textContent)).toEqual([
      'MP',
      'YC',
      'RC',
    ]);
  });

  it('esporte sem estatística de jogador: estado vazio; sem campeonato: pede um', async () => {
    const empty: typeof fetch = async () =>
      json({
        competition_id: PREVIEW_IDS.competition,
        sport: 'basketball',
        season: { year: 2026, label: '2025-26' },
        category: 'goals',
        data: [],
        updated_at: null,
      });
    setup(<CompetitionLeaders competitionId="nba" />, { fetch: empty });
    expect(await screen.findByText('Sem estatísticas de jogador nesta temporada.')).toBeTruthy();
    cleanup();
    setup(<CompetitionLeaders competitionId="" />);
    expect(screen.getByText('Escolha um campeonato.')).toBeTruthy();
  });
});

describe('galeria de campeões', () => {
  it('edições da mais recente para trás, ranking de títulos e vice', async () => {
    const { container } = setup(<Champions competitionId={PREVIEW_IDS.competition} limit={5} showRunnerUp />);
    expect(await screen.findByText('Mais títulos')).toBeTruthy();
    const editions = [...container.querySelectorAll('[data-gs-champions] tbody tr')];
    expect(editions).toHaveLength(5);
    expect(cells(editions[0]!)[0]).toBe('2025');
    expect(cells(editions[0]!)).toHaveLength(3);
    const ranking = [...container.querySelectorAll('[data-gs-ranking] tr')];
    expect(cells(ranking[0]!)[1]).toBe('4');
  });

  it('lista com lacunas: sem ranking, com o aviso; campeão não ligado aparece "A confirmar"', async () => {
    const gaps: typeof fetch = async () =>
      json({
        competition_id: PREVIEW_IDS.competition,
        sport: 'football',
        data: [
          {
            season_year: 2025,
            season_label: '2025',
            decided_on: '2025-12-07',
            champion: null,
            runner_up: null,
          },
        ],
        editions: 1,
        ranking: null,
        coverage: { first_year: 1959, complete_through: 1963, unidentified: 1 },
      });
    const { container } = setup(<Champions competitionId="brasileirao-serie-a" />, { fetch: gaps });
    expect(await screen.findByText('A confirmar')).toBeTruthy();
    expect(container.querySelector('[data-gs-no-ranking]')).toBeTruthy();
    expect(container.querySelector('[data-gs-ranking]')).toBeNull();
  });

  it('competição sem campeões guardados: estado vazio', async () => {
    const none: typeof fetch = async () =>
      json({
        competition_id: PREVIEW_IDS.competition,
        sport: 'basketball',
        data: [],
        editions: 0,
        ranking: null,
        coverage: null,
      });
    setup(<Champions competitionId="nba" showRanking={false} />, { fetch: none });
    expect(await screen.findByText('Sem campeões registrados para este campeonato.')).toBeTruthy();
  });
});

describe('catálogo e opções', () => {
  it('tipos novos no catálogo com o esporte de cada um', () => {
    expect(WIDGET_CATALOG.derby_week.sports).toEqual(['football']);
    expect(WIDGET_CATALOG.competition_leaders.requiredProps).toEqual(['competitionId']);
    expect(WIDGET_CATALOG.champions.sports).toEqual(
      expect.arrayContaining(['football', 'basketball', 'formula-1']),
    );
    expect(WIDGET_CATALOG.champions.sports).not.toContain('equestrian');
  });

  it('opções conferidas: país conhecido, categoria, limites', () => {
    expect(parseWidgetOptions('derby_week', { country: 'GB-ENG', days: 60, limit: 3 })).toEqual({
      country: 'GB-ENG',
      days: 30,
      limit: 3,
    });
    expect(parseWidgetOptions('derby_week', { country: 'XX' })).toBeUndefined();
    expect(parseWidgetOptions('competition_leaders', { category: 'cards', season: '2025' })).toEqual({
      category: 'cards',
      season: 2025,
    });
    expect(parseWidgetOptions('champions', { showRunnerUp: true, limit: 0 })).toEqual({
      showRunnerUp: true,
      limit: 0,
    });
  });

  it('listas em ordem alfabética pt-BR', () => {
    const labels = DERBY_COUNTRIES.map((c) => c.label['pt-BR']);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    const categories = WIDGET_OPTIONS.competition_leaders.find((o) => o.key === 'category');
    const names = categories && 'values' in categories ? categories.values.map((v) => v.label['pt-BR']) : [];
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  });
});
