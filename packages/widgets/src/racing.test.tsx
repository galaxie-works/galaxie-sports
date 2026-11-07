import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { AthleteProfile } from './widgets/athlete-profile.js';
import { FightCard } from './widgets/fight-card.js';
import { MatchCard } from './widgets/match-card.js';
import { RaceResult } from './widgets/race-result.js';
import { RaceWeekend } from './widgets/race-weekend.js';
import { SeasonCalendar } from './widgets/season-calendar.js';
import { StandingsTable } from './widgets/standings-table.js';

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

describe('F1', () => {
  it('resultado da corrida: posição, piloto, equipe, tempo do líder, diferença e largada', async () => {
    const { container } = setup(<RaceResult eventId={PREVIEW_IDS.raceEvent} />);
    expect(await screen.findByText('GP Exemplo · Corrida')).toBeTruthy();
    const rows = container.querySelectorAll('[data-gs-race] tbody tr');
    expect(rows).toHaveLength(8);
    expect(cells(rows[0]!)).toEqual(['1', 'Lucas Andrade', 'Equipe Aurora', '1:32:14.208', '3']);
    expect(cells(rows[1]!)[3]).toBe('+3.412');
    expect(screen.getByText(/Volta mais rápida: .* 1:33\.402/)).toBeTruthy();
  });

  it('fim de semana do GP: as sessões em ordem, com o vencedor de cada', async () => {
    const { container } = setup(<RaceWeekend eventId={PREVIEW_IDS.raceEvent} />);
    await screen.findByText('Corrida');
    const names = [...container.querySelectorAll('.gs-fixture .gs-strong')].map((n) => n.textContent);
    expect(names).toEqual(['Treino livre 1', 'Treino livre 2', 'Sprint', 'Classificação', 'Corrida']);
    expect(screen.getByText('Venceu: Lucas Andrade')).toBeTruthy();
  });

  it('calendário da temporada: os GPs com o vencedor e a próxima etapa em destaque', async () => {
    const { container } = setup(<SeasonCalendar competitionId={PREVIEW_IDS.raceCompetition} />);
    await screen.findByText('GP Exemplo');
    expect(container.querySelectorAll('.gs-fixture')).toHaveLength(6);
    const next = container.querySelector('[data-next]')!;
    expect(next.textContent).toContain('Próxima');
  });

  it('classificação de pilotos e de construtores', async () => {
    const { container } = setup(<StandingsTable competitionId={PREVIEW_IDS.raceCompetition} />);
    await screen.findByText('Pilotos');
    expect(screen.getByText('Construtores')).toBeTruthy();
    const head = [...container.querySelectorAll('[data-gs-race-standings=drivers] thead th')].map(
      (t) => t.textContent,
    );
    expect(head).toEqual(['#', 'Piloto', 'Pts', 'Vitórias', 'Pódios']);
    cleanup();
    const only = setup(
      <StandingsTable competitionId={PREVIEW_IDS.raceCompetition} raceTable="constructors" />,
    );
    await screen.findByText('Construtores');
    expect(only.container.querySelector('[data-gs-race-standings=drivers]')).toBeNull();
  });

  it('perfil do piloto: temporada atual e carreira', async () => {
    setup(<AthleteProfile teamId={PREVIEW_IDS.driver} />);
    expect(await screen.findByText('Temporada ' + new Date().getUTCFullYear())).toBeTruthy();
    expect(screen.getByText('Carreira')).toBeTruthy();
    expect(screen.getByText('104')).toBeTruthy(); // corridas
  });
});

describe('MMA', () => {
  it('card do evento: card principal e preliminares, com o desfecho', async () => {
    const { container } = setup(<FightCard eventId={PREVIEW_IDS.fightEvent} />);
    expect(await screen.findByText('Liga Exemplo 50: Ribeiro × Navarro')).toBeTruthy();
    expect(screen.getByText('Card principal')).toBeTruthy();
    expect(screen.getByText('Preliminares')).toBeTruthy();
    expect(container.querySelectorAll('.gs-bout')).toHaveLength(5);
    expect(screen.getAllByText('Nocaute técnico · Socos · R2 · 3:41').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Juízes: 29-28, 29-28, 30-27').length).toBeGreaterThan(0);
  });

  it('resultado da luta no placar: método, round e tempo, sem placar inventado', async () => {
    const { container } = setup(<MatchCard eventId={PREVIEW_IDS.fightEvent} />);
    expect(await screen.findByText('Nocaute técnico')).toBeTruthy();
    expect(screen.getByText('Socos · R2 · 3:41')).toBeTruthy();
    expect(container.querySelector('.gs-score')).toBeNull();
    expect(container.querySelector('[data-won]')!.textContent).toContain('Caio Ribeiro');
  });

  it('perfil do lutador: cartel, próxima luta e últimas lutas', async () => {
    const { container } = setup(<AthleteProfile teamId={PREVIEW_IDS.fighter} />);
    expect(await screen.findByText('Cartel')).toBeTruthy();
    const record = [...container.querySelectorAll('.gs-stat strong')].map((s) => s.textContent);
    expect(record).toEqual(['5', '1', '0']);
    expect(screen.getByText('Próxima')).toBeTruthy();
    expect(screen.getByText('Últimas lutas')).toBeTruthy();
  });

  it('próximos eventos: os cards que vêm pela frente', async () => {
    // meio da tarde em São Paulo: entre 21h e meia-noite o card de ontem (UTC) cai no "hoje" do fuso do widget
    vi.useFakeTimers({ now: new Date('2026-06-15T18:00:00Z'), shouldAdvanceTime: true });
    onTestFinished(() => vi.useRealTimers());
    const { container } = setup(<SeasonCalendar competitionId={PREVIEW_IDS.fightCompetition} />);
    expect(await screen.findByText('Liga Exemplo 51')).toBeTruthy();
    expect(container.querySelectorAll('.gs-fixture')).toHaveLength(3);
  });
});

describe('catálogo', () => {
  it('os tipos novos ficam nas abas da F1 e do MMA', () => {
    expect(WIDGET_CATALOG.race_result.sports).toEqual(['formula-1']);
    expect(WIDGET_CATALOG.fight_card.sports).toEqual(['mma']);
    expect(WIDGET_CATALOG.standings.sports).toContain('formula-1');
    expect(WIDGET_CATALOG.where_to_watch.sports).toEqual(expect.arrayContaining(['formula-1', 'mma']));
  });
});
