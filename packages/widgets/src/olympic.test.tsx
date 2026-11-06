import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, flagEmoji, pickCurrentGames } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { parseWidgetOptions } from './options.js';
import { CountryAthletes } from './widgets/country-athletes.js';
import { CountryToday } from './widgets/country-today.js';
import { EquestrianCalendar } from './widgets/equestrian-calendar.js';
import { EquestrianRanking } from './widgets/equestrian-ranking.js';
import { EquestrianResults } from './widgets/equestrian-results.js';
import { GamesSchedule } from './widgets/games-schedule.js';
import { HorseProfile } from './widgets/horse-profile.js';
import { MedalHistory } from './widgets/medal-history.js';
import { MedalTable } from './widgets/medal-table.js';
import { RiderProfile } from './widgets/rider-profile.js';

afterEach(cleanup);

function setup(ui: ReactNode) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale="pt-BR"
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={createPreviewFetch()}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

const cells = (row: Element) => [...row.querySelectorAll('td')].map((td) => td.textContent);

describe('hipismo', () => {
  it('resultado da prova (a mais recente sem id): posição, conjunto, faltas e tempo; eliminado no fim', async () => {
    const { container } = setup(<EquestrianResults />);
    expect(await screen.findByText('GP Exemplo CSI5*')).toBeTruthy();
    const rows = container.querySelectorAll('[data-gs-eq-results] tbody tr');
    expect(rows).toHaveLength(8);
    expect(cells(rows[0]!)).toEqual(['1', '🇧🇷Rafael MonteiroVento Sul', '0 · 38.41s']);
    expect(cells(rows[7]!)[2]).toBe('EL');
  });

  it('ranking: posição, cavaleiro e pontos, até o limite', async () => {
    const { container } = setup(<EquestrianRanking limit={3} />);
    expect(await screen.findByText('Ranking Mundial de Salto')).toBeTruthy();
    expect(container.querySelectorAll('[data-gs-eq-ranking] tr')).toHaveLength(3);
  });

  it('calendário: as próximas provas em ordem de data, a primeira em destaque', async () => {
    const { container } = setup(<EquestrianCalendar />);
    expect(await screen.findByText('GP Exemplo CSI4*')).toBeTruthy();
    const names = [...container.querySelectorAll('.gs-fixture .gs-strong')].map((n) => n.textContent);
    expect(names).toEqual(['GP Exemplo CSI4*', 'Copa Exemplo CSI3*', 'GP Exemplo CSI5*-W']);
    expect(container.querySelector('[data-next]')!.textContent).toContain('GP Exemplo CSI4*');
    cleanup();
    const gp = setup(<EquestrianCalendar range="recent" grandPrixOnly />);
    await screen.findByText('GP Exemplo CSI5*');
    expect(gp.container.querySelectorAll('.gs-fixture')).toHaveLength(1);
  });

  it('perfil do cavaleiro: números, cavalos e últimos resultados', async () => {
    setup(<RiderProfile athleteId={PREVIEW_IDS.eqAthlete} />);
    expect(await screen.findByText('Rafael Monteiro')).toBeTruthy();
    expect(screen.getByText('142')).toBeTruthy();
    expect(screen.getAllByText('Cavalos')).toHaveLength(2); // número e lista
    expect(await screen.findByText('Últimos resultados')).toBeTruthy();
  });

  it('perfil do cavalo: raça, idade, sexo, pedigree e cavaleiros', async () => {
    setup(<HorseProfile />);
    expect(await screen.findByText('Vento Sul')).toBeTruthy();
    expect(screen.getByText(/Castrado/)).toBeTruthy();
    expect(screen.getByText('Vento Norte')).toBeTruthy();
    expect(screen.getAllByText('Cavaleiros')).toHaveLength(2);
  });
});

describe('Olimpíadas e Pan', () => {
  it('a edição sem escolha: a em andamento; senão a última encerrada', () => {
    const g = (slug: string, status: 'completed' | 'in_progress' | 'upcoming', start_date: string) => ({
      slug,
      status,
      start_date,
    });
    expect(pickCurrentGames([g('a', 'completed', '2021'), g('b', 'in_progress', '2024')])?.slug).toBe('b');
    expect(
      pickCurrentGames([g('a', 'completed', '2021'), g('c', 'completed', '2024'), g('d', 'upcoming', '2028')])
        ?.slug,
    ).toBe('c');
    expect(flagEmoji('br')).toBe('🇧🇷');
    expect(flagEmoji(null)).toBe('');
  });

  it('quadro de medalhas: ouro, prata, bronze e total, com o Brasil em destaque fora do top', async () => {
    const { container } = setup(<MedalTable limit={5} />);
    await screen.findByText('Estados Unidos');
    const rows = container.querySelectorAll('[data-gs-medals] tbody tr');
    expect(rows).toHaveLength(6);
    expect(cells(rows[0]!)).toEqual(['1', '🇺🇸Estados Unidos', '22', '18', '16', '56']);
    expect(rows[5]!.className).toBe('gs-highlight');
    expect(rows[5]!.textContent).toContain('Brasil');
  });

  it('Brasil hoje: provas do dia, a ao vivo, as que valem medalha e as medalhas', async () => {
    const { container } = setup(<CountryToday />);
    expect(await screen.findByText('Brasil hoje')).toBeTruthy();
    expect(screen.getByText('Bianca Moreira')).toBeTruthy();
    expect(container.querySelectorAll('[data-gs-unit]')).toHaveLength(5);
    expect(container.querySelector('[data-live]')!.textContent).toContain('Vôlei de praia');
    expect(screen.getAllByText('Vale medalha')).toHaveLength(2);
  });

  it('programação: só as que valem medalha, quando pedido', async () => {
    const { container } = setup(<GamesSchedule medalOnly />);
    await screen.findByText('Atletismo');
    expect(container.querySelectorAll('[data-gs-unit]')).toHaveLength(3);
  });

  it('atletas do país: medalhistas primeiro (ouro antes de prata)', async () => {
    const { container } = setup(<CountryAthletes />);
    await screen.findByText('Caio Ventura');
    const names = [...container.querySelectorAll('[data-gs-athlete] .gs-strong')].map((n) => n.textContent);
    expect(names.slice(0, 3)).toEqual(['Caio Ventura', 'Bianca Moreira', 'Pedro Alencar']);
  });

  it('histórico de medalhas: da edição mais recente para trás, com a soma', async () => {
    const { container } = setup(<MedalHistory limit={3} />);
    await screen.findByText('Jogos Olímpicos Paris 2024');
    expect(container.querySelectorAll('[data-gs-medal-history] tbody tr')).toHaveLength(3);
    expect(screen.getByText('Soma de 5 edições')).toBeTruthy();
  });
});

describe('catálogo e opções', () => {
  it('os tipos novos ficam nas abas do hipismo e dos Jogos, sem entidade obrigatória', () => {
    expect(WIDGET_CATALOG.rider_profile.sports).toEqual(['equestrian']);
    expect(WIDGET_CATALOG.medal_table.sports).toEqual(['multisport']);
    expect(WIDGET_CATALOG.country_today.requiredProps).toEqual([]);
  });

  it('opções: id da prova só UUID, edição só slug, país da lista', () => {
    expect(parseWidgetOptions('rider_profile', { athleteId: 'x' })).toBeUndefined();
    expect(parseWidgetOptions('rider_profile', { athleteId: PREVIEW_IDS.eqAthlete })).toEqual({
      athleteId: PREVIEW_IDS.eqAthlete,
    });
    expect(parseWidgetOptions('medal_table', { games: 'og-summer-2024', highlight: 'ARG' })).toEqual({
      games: 'og-summer-2024',
      highlight: 'ARG',
    });
    expect(parseWidgetOptions('country_today', { games: 'OG 2024!', noc: 'XXX' })).toBeUndefined();
  });
});
