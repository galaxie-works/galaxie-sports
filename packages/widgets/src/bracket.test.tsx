import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type GsBracketRound } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { parseWidgetOptions } from './options.js';
import { Bracket, bracketRoundsFrom, currentRoundIndex } from './widgets/bracket.js';

afterEach(cleanup);

function setup(ui: ReactNode, sport?: string, locale: 'pt-BR' | 'es' | 'en' = 'pt-BR') {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale={locale}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={createPreviewFetch(sport ? { sport } : {})}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

/** Cada linha do confronto: o time e os números (jogos em miúdo, pênaltis e o agregado), separados. */
const lines = (tie: Element) =>
  [...tie.querySelectorAll('.gs-tie-line')].map((l) =>
    [l.querySelector('.gs-truncate'), ...l.querySelectorAll('.gs-tie-score > *')]
      .map((n) => n?.textContent)
      .join(' '),
  );

const round = (kind: string, decided = true): GsBracketRound => ({
  stage_id: kind,
  kind,
  name: kind,
  ties: [
    {
      id: kind,
      home: null,
      away: null,
      format: 'single',
      legs: [],
      aggregate: null,
      wins: null,
      penalties: null,
      winner_id: null,
      status: decided ? 'decided' : 'scheduled',
    },
  ],
});

describe('chaveamento do mata-mata', () => {
  it('fases lado a lado, com ida e volta, agregado, pênaltis e quem avançou', async () => {
    const { container } = setup(<Bracket competitionId={PREVIEW_IDS.cupCompetition} layout="bracket" />);
    expect(await screen.findByText('Quartas de final')).toBeTruthy();
    const rounds = container.querySelectorAll('.gs-bracket-round');
    expect([...rounds].map((r) => r.getAttribute('data-kind'))).toEqual([
      'quarter_final',
      'semi_final',
      'final',
    ]);
    const qf = rounds[0]!.querySelectorAll('.gs-tie');
    expect(qf).toHaveLength(4);
    // Aurora 2×0 e 1×1 na volta: agregado 3×1
    expect(lines(qf[0]!)).toEqual(['Aurora 2 1 3', 'Pampa 0 1 1']);
    expect(qf[0]!.querySelector('[data-won]')?.textContent).toContain('Aurora (classificado)');
    // Cerrado × Estrela: 1×1, 0×0 e pênaltis 4×3 para o Cerrado
    expect(lines(qf[2]!)).toEqual(['Cerrado 1 0 (4 pên.) 1', 'Estrela 1 0 (3 pên.) 1']);
    // semifinal em aberto: data da volta; final ainda sem adversário
    const sf = rounds[1]!.querySelectorAll('.gs-tie');
    expect(sf[1]!.querySelector('.gs-tie-meta')?.textContent).toContain('Volta');
    expect(rounds[2]!.textContent).toContain('A definir');
  });

  it('fase por fase: abre a fase em aberto e troca pelo seletor', async () => {
    const { container } = setup(<Bracket competitionId={PREVIEW_IDS.cupCompetition} layout="rounds" />);
    const semi = await screen.findByRole('button', { name: 'Semifinal' });
    expect(semi.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.gs-bracket-list .gs-tie')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Quartas de final' }));
    expect(container.querySelectorAll('.gs-bracket-list .gs-tie')).toHaveLength(4);
  });

  it('sem agregado nem ida e volta: só o agregado some, os jogos continuam', async () => {
    const { container } = setup(
      <Bracket competitionId={PREVIEW_IDS.cupCompetition} layout="bracket" showAggregate={false} />,
    );
    await screen.findByText('Quartas de final');
    const first = container.querySelector('.gs-tie')!;
    expect(lines(first)).toEqual(['Aurora 2 1', 'Pampa 0 1']);
  });

  it('a partir da semifinal e destaque do time', async () => {
    const aurora = '0199a5c0-0000-7000-8000-0000000000b1';
    const { container } = setup(
      <Bracket
        competitionId={PREVIEW_IDS.cupCompetition}
        layout="bracket"
        from="semi_final"
        highlightTeamId={aurora}
      />,
    );
    await screen.findByText('Semifinal');
    expect(screen.queryByText('Quartas de final')).toBeNull();
    expect(container.querySelectorAll('.gs-tie[data-highlight]')).toHaveLength(2);
  });

  it('série melhor de 7 nos playoffs (basquete): vitórias de cada lado', async () => {
    const { container } = setup(
      <Bracket competitionId={PREVIEW_IDS.cupCompetition} layout="bracket" />,
      'basketball',
      'en',
    );
    // os nomes das fases vêm da API (no exemplo, sempre em português)
    await screen.findByText('Quartas de final');
    const first = container.querySelector('.gs-tie')!;
    expect(first.querySelector('.gs-tie-meta')?.textContent).toContain('Series');
    expect([...first.querySelectorAll('.gs-tie-score strong')].map((s) => s.textContent)).toEqual(['4', '2']);
  });

  it('recorte de fases: desconhecidas ficam, recorte vazio mostra tudo, 3º lugar opcional', () => {
    const all = [round('quarter_final'), round('semi_final'), round('third_place'), round('final', false)];
    expect(bracketRoundsFrom(all, 'semi_final', true).map((r) => r.kind)).toEqual([
      'semi_final',
      'third_place',
      'final',
    ]);
    expect(bracketRoundsFrom(all, 'semi_final', false).map((r) => r.kind)).toEqual(['semi_final', 'final']);
    expect(bracketRoundsFrom([round('quarter_final')], 'final', true)).toHaveLength(1);
    expect(currentRoundIndex(all)).toBe(3);
    expect(currentRoundIndex([round('semi_final'), round('final'), round('third_place')])).toBe(1);
  });

  it('catálogo e opções: competição obrigatória, esportes coletivos, opção fora da lista é descartada', () => {
    expect(WIDGET_CATALOG.bracket.requiredProps).toEqual(['competitionId']);
    expect(WIDGET_CATALOG.bracket.sports).toContain('basketball');
    expect(
      parseWidgetOptions('bracket', { from: 'quarter_final', layout: 'x', showAggregate: true }),
    ).toEqual({
      from: 'quarter_final',
    });
  });
});
