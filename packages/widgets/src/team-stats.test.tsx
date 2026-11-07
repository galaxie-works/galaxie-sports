import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { WIDGET_OPTIONS, parseWidgetOptions } from './options.js';
import { TeamStats } from './widgets/team-stats.js';

afterEach(cleanup);

function setup(ui: ReactNode, locale: WidgetLocale = 'pt-BR', fetchImpl = createPreviewFetch()) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.light}
      locale={locale}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={fetchImpl}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

const blocks = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-gs-block]')].map((n) => n.getAttribute('data-gs-block'));
const block = (c: HTMLElement, name: string) => c.querySelector(`[data-gs-block="${name}"]`)!;

describe('Estatísticas do time (#893)', () => {
  it('cabeçalho com o time, o campeonato e a temporada; os blocos padrão na ordem de leitura', async () => {
    const { container } = setup(<TeamStats teamId={PREVIEW_IDS.team} />);
    expect(await screen.findByText('Resumo da temporada')).toBeTruthy();
    expect(await screen.findByText('Clube Aurora')).toBeTruthy();
    expect(screen.getByText('Liga Exemplo · 2026')).toBeTruthy();
    // cartões vêm desligados por padrão
    expect(blocks(container)).toEqual([
      'summary',
      'form',
      'home-away',
      'goals-by-minute',
      'highlights',
      'formations',
    ]);
    const summary = block(container, 'summary');
    expect(summary.textContent).toContain('34Jogos');
    expect(summary.textContent).toContain('18Vitórias');
    expect(summary.textContent).toContain('Gols pró: 1,5 por jogo');
    expect(container.textContent).toContain('Atualizado em 06/11/26');
  });

  it('forma: os últimos N, do mais antigo (esquerda) ao mais recente (direita)', async () => {
    const { container } = setup(<TeamStats teamId={PREVIEW_IDS.team} formCount={4} />);
    await screen.findByText('Forma');
    // a API manda "WWDLWWDWLW" do mais recente ao mais antigo: os 4 últimos são W W D L → lidos L D W W
    const chips = [...block(container, 'form').querySelectorAll('.gs-result')].map((n) =>
      n.getAttribute('data-r'),
    );
    expect(chips).toEqual(['L', 'D', 'W', 'W']);
  });

  it('casa e fora lado a lado, gols por minuto e destaques vistos pelo time', async () => {
    const { container } = setup(<TeamStats teamId={PREVIEW_IDS.team} showCards />);
    await screen.findByText('Casa e fora');
    const rows = [...block(container, 'home-away').querySelectorAll('.gs-statrow')].map((r) =>
      [...r.children].map((c) => c.textContent),
    );
    expect(rows[0]).toEqual(['Casa', '', 'Fora']);
    expect(rows).toContainEqual(['11', 'Vitórias', '7']);
    expect(rows).toContainEqual(['9', 'Sem sofrer gol', '5']);
    const minutes = block(container, 'goals-by-minute');
    expect(minutes.textContent).toContain("76–90'");
    expect(minutes.querySelectorAll('.gs-mbar[data-side=for]')).toHaveLength(6);
    const highlights = block(container, 'highlights').textContent;
    expect(highlights).toContain('Vitórias seguidas6');
    expect(highlights).toContain('Maior vitória5 × 0 (casa)');
    expect(highlights).toContain('Maior derrota1 × 3 (fora)');
    expect(highlights).toContain('Pênaltis6 de 7');
    expect(block(container, 'formations').textContent).toContain('4-2-3-119 jogos');
    expect(block(container, 'cards').querySelectorAll('.gs-mbar[data-side=red]').length).toBeGreaterThan(0);
  });

  it('blocos desligados não aparecem', async () => {
    const { container } = setup(
      <TeamStats
        teamId={PREVIEW_IDS.team}
        showSummary={false}
        showForm={false}
        showHomeAway={false}
        showGoalsByMinute={false}
        showHighlights={false}
        showFormations
      />,
    );
    await screen.findByText('Formações mais usadas');
    expect(blocks(container)).toEqual(['formations']);
  });

  it('campeonato e temporada vão para a API', async () => {
    const urls: string[] = [];
    const preview = createPreviewFetch();
    const spy: typeof fetch = (input, init) => {
      urls.push(String(input));
      return preview(input, init);
    };
    setup(<TeamStats teamId={PREVIEW_IDS.team} competitionId="liga-exemplo" season={2025} />, 'pt-BR', spy);
    expect(await screen.findByText('Liga Exemplo · 2025')).toBeTruthy();
    const call = urls.find((u) => u.includes('/statistics?'))!;
    expect(call).toContain('competition=liga-exemplo');
    expect(call).toContain('season=2025');
  });

  it('textos em espanhol e inglês', async () => {
    const es = setup(<TeamStats teamId={PREVIEW_IDS.team} />, 'es');
    expect(await screen.findByText('Resumen de la temporada')).toBeTruthy();
    expect(es.container.textContent).toContain('Local y visitante');
    es.unmount();
    const en = setup(<TeamStats teamId={PREVIEW_IDS.team} />, 'en');
    expect(await screen.findByText('Season summary')).toBeTruthy();
    expect(en.container.textContent).toContain('Biggest win5 × 0 (home)');
  });

  it('sem o dado (esporte sem estatísticas): estado vazio claro', async () => {
    const empty: typeof fetch = async (input) => {
      const url = String(input);
      const body = url.includes('/statistics')
        ? { team_id: 'x', sport: 'basketball', data: null, available: [] }
        : { id: 'x', sport: 'basketball', kind: 'team', name: 'Cesta', short_name: null, logo: null };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    setup(<TeamStats teamId={PREVIEW_IDS.team} />, 'pt-BR', empty);
    expect(await screen.findByText('Sem estatísticas deste time para a temporada.')).toBeTruthy();
  });

  it('catálogo e opções: futebol, time obrigatório, blocos em WIDGET_OPTIONS', () => {
    const entry = WIDGET_CATALOG.team_stats;
    expect(entry.sports).toEqual(['football']);
    expect(entry.requiredProps).toEqual(['teamId']);
    // toda opção é prop do componente (e está no catálogo)
    for (const o of WIDGET_OPTIONS.team_stats) expect(entry.optionalProps).toContain(o.key);
    expect(
      parseWidgetOptions('team_stats', {
        showSummary: true,
        showCards: true,
        formCount: '20',
        season: '2025',
        competitionId: 'liga-exemplo',
      }),
    ).toEqual({ showCards: true, formCount: 10, season: 2025, competitionId: 'liga-exemplo' });
  });
});
