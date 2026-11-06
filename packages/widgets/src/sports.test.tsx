import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_THEMES,
  TEAM_SPORTS,
  liveClockText,
  periodCodeOf,
  periodLabel,
  sportProfile,
  standingPercentage,
  textsFor,
} from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch, createPreviewFixtures } from './fixtures.js';
import { HeadToHead } from './widgets/head-to-head.js';
import { MatchCard } from './widgets/match-card.js';
import { StandingsTable } from './widgets/standings-table.js';

afterEach(cleanup);

function setup(ui: ReactNode, sport: string) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale="pt-BR"
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={createPreviewFetch({ sport })}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

const headers = (container: HTMLElement) =>
  [...container.querySelectorAll('.gs-group thead th')].map((th) => th.textContent);

describe('perfil de cada esporte', () => {
  const pt = textsFor('pt-BR');

  it('futebol é o padrão (esporte ausente ou desconhecido)', () => {
    expect(sportProfile(undefined).sport).toBe('football');
    expect(sportProfile('curling').draws).toBe(true);
    expect(TEAM_SPORTS).toContain('volleyball');
  });

  it('código da parcial a partir do relógio do fornecedor, e o rótulo curto', () => {
    expect(['Q3', 'S2', '1H', 'P1', 'IN7', 'OT', 'OT2', 'PT', 'HT', 'first_half'].map(periodCodeOf)).toEqual([
      'q3',
      's2',
      'h1',
      'p1',
      'i7',
      'ot',
      'ot2',
      'so',
      null,
      null,
    ]);
    expect(['q2', 's3', 'h1', 'p1', 'i7', 'ot', 'so'].map((c) => periodLabel(c, pt))).toEqual([
      '2Q',
      '3S',
      '1T',
      '1P',
      '7',
      'Prorr.',
      'Pên.',
    ]);
    expect(periodLabel('q2', textsFor('en'))).toBe('Q2');
  });

  it('relógio ao vivo: minuto no futebol, parcial nos outros', () => {
    expect(liveClockText({ sport: 'football', clock: { minute: 67, extra: null, period: '2H' } }, pt)).toBe(
      "67'",
    );
    expect(
      liveClockText({ sport: 'basketball', clock: { minute: null, extra: null, period: 'Q3' } }, pt),
    ).toBe('3Q');
    expect(liveClockText({ sport: 'hockey', clock: { minute: 12, extra: null, period: 'P2' } }, pt)).toBe(
      "2P 12'",
    );
  });

  it('aproveitamento: pontos no futebol, vitórias no basquete (empate vale meia), pró ÷ contra na AFL', () => {
    const row = { points: 20, played: 10, won: 6, drawn: 2, lost: 2, goals_for: 900, goals_against: 800 };
    expect(standingPercentage(row, sportProfile('football'))).toBe('67');
    expect(standingPercentage(row, sportProfile('american-football'))).toBe('70');
    expect(standingPercentage(row, sportProfile('afl'))).toBe('112.5');
    expect(standingPercentage({ ...row, played: 0 }, sportProfile('nba'))).toBeNull();
  });
});

describe('tabela nos outros esportes', () => {
  it('basquete: sem pontos nem empate, com % de vitórias e saldo de pontos', async () => {
    const { container } = setup(<StandingsTable competitionId={PREVIEW_IDS.competition} />, 'basketball');
    await screen.findByText('Aurora');
    expect(headers(container)).toEqual(['#', 'Time', 'J', 'V', 'D', 'SP', '%V']);
  });

  it('hóquei: pontos e derrotas na prorrogação (DP), sem empate', async () => {
    const { container } = setup(<StandingsTable competitionId={PREVIEW_IDS.competition} />, 'hockey');
    await screen.findByText('Aurora');
    expect(headers(container)).toEqual(['#', 'Time', 'P', 'J', 'V', 'D', 'DP', 'SG']);
  });

  it('vôlei: saldo de sets; AFL: o percentual pró ÷ contra', async () => {
    const v = setup(<StandingsTable competitionId={PREVIEW_IDS.competition} />, 'volleyball');
    await screen.findByText('Aurora');
    expect(headers(v.container)).toEqual(['#', 'Time', 'P', 'J', 'V', 'D', 'SS']);
    cleanup();
    const a = setup(<StandingsTable competitionId={PREVIEW_IDS.competition} />, 'afl');
    await screen.findByText('Aurora');
    expect(headers(a.container)).toEqual(['#', 'Time', 'P', 'J', 'V', 'E', 'D', 'SP', '%']);
  });

  it('todos os esportes coletivos têm tabela de exemplo coerente (jogos = V + E + D)', () => {
    for (const sport of TEAM_SPORTS) {
      const rows = createPreviewFixtures(new Date(), sport).standings.groups[0]!.rows;
      for (const r of rows) expect(r.played).toBe(r.won + r.drawn + r.lost);
      if (!sportProfile(sport).draws) expect(rows.every((r) => r.drawn === 0)).toBe(true);
    }
  });
});

describe('placar nos outros esportes', () => {
  it('vôlei: sets no placar e os pontos de cada set na tabela de parciais', async () => {
    const { container } = setup(<MatchCard eventId={PREVIEW_IDS.finishedEvent} />, 'volleyball');
    await screen.findByText('3 – 1');
    const table = container.querySelector('[data-gs-periods]')!;
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Time',
      '1S',
      '2S',
      '3S',
      '4S',
      'Total',
    ]);
  });

  it('basquete ao vivo: o quarto em andamento no selo, sem minuto de futebol', async () => {
    const { container } = setup(<MatchCard eventId={PREVIEW_IDS.liveEvent} />, 'basketball');
    await screen.findByText('Estrela', { selector: '.gs-team span' });
    expect(container.querySelector('.gs-badge')!.textContent).toBe('3Q Ao vivo');
    expect(screen.queryByText("67'")).toBeNull();
  });

  it('AFL: gols e behinds embaixo do placar', async () => {
    setup(<MatchCard eventId={PREVIEW_IDS.finishedEvent} />, 'afl');
    expect(await screen.findByText(/^\d+\.\d+ – \d+\.\d+$/)).toBeTruthy();
  });

  it('as parciais podem ser desligadas', async () => {
    const { container } = setup(
      <MatchCard eventId={PREVIEW_IDS.finishedEvent} showPeriods={false} />,
      'basketball',
    );
    await screen.findByText('Planalto');
    expect(container.querySelector('[data-gs-periods]')).toBeNull();
  });
});

describe('confronto nos outros esportes', () => {
  it('basquete: sem a coluna de empates', async () => {
    setup(<HeadToHead eventId={PREVIEW_IDS.scheduledEvent} />, 'basketball');
    await screen.findByText('Atlético Serra');
    // o retrospecto de exemplo tem 1 empate no futebol; no basquete ele vira vitória
    expect(screen.queryByText('Empates')).toBeNull();
  });
});
