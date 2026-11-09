import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { parseWidgetOptions } from './options.js';
import { TeamSquad } from './widgets/team-squad.js';

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

const groupTitles = (c: HTMLElement) => [...c.querySelectorAll('.gs-group-title')].map((n) => n.textContent);
const names = (c: Element) => [...c.querySelectorAll('.gs-strong')].map((n) => n.textContent);

describe('Elenco do time (#825)', () => {
  it('agrupa por posição (goleiros primeiro), ordena pela camisa e fecha com os técnicos', async () => {
    const { container } = setup(<TeamSquad teamId={PREVIEW_IDS.team} />);
    expect(await screen.findByText('Rafael Moura')).toBeTruthy();
    expect(screen.getByText('Clube Aurora')).toBeTruthy();
    expect(screen.getByText('Elenco · 12 jogadores')).toBeTruthy();
    expect(groupTitles(container)).toEqual([
      'Goleiros',
      'Defensores',
      'Meio-campistas',
      'Atacantes',
      'Outros',
      'Técnicos',
    ]);
    const defenders = container.querySelector('[data-gs-group=Defender]')!;
    expect(names(defenders)).toEqual(['Tiago Brandão', 'Lucas Fontes', 'Martín Ibarra', 'Diego Sosa']);
    const first = container.querySelector('[data-gs-person]')!;
    expect(first.querySelector('.gs-shirt')?.textContent).toBe('1');
    expect(first.querySelector('.gs-shirt')?.getAttribute('aria-label')).toBe('Camisa 1');
    expect(first.querySelector('.gs-photo')).toBeTruthy();
    expect(first.textContent).toContain('Brasil · 31 anos');
    expect(screen.getAllByRole('img', { name: 'Argentina', hidden: true })).toHaveLength(2);
  });

  it('opções desligadas: sem foto, número, idade, nacionalidade, grupos nem técnicos', async () => {
    const { container } = setup(
      <TeamSquad
        teamId={PREVIEW_IDS.team}
        showPhotos={false}
        groupByPosition={false}
        showNumber={false}
        showAge={false}
        showNationality={false}
        showCoaches={false}
      />,
    );
    await screen.findByText('Rafael Moura');
    expect(groupTitles(container)).toEqual([]);
    expect(container.querySelectorAll('[data-gs-person]')).toHaveLength(12);
    expect(container.querySelector('.gs-shirt')).toBeNull();
    expect(container.querySelector('.gs-photo')).toBeNull();
    expect(container.querySelector('[data-gs-person] .gs-meta')).toBeNull();
    expect(screen.queryByText('Renato Albuquerque')).toBeNull();
    // sem grupos, a ordem continua por posição e camisa
    expect(names(container).slice(0, 3)).toEqual(['Rafael Moura', 'Caio Prado', 'Tiago Brandão']);
  });

  it('temporada vai para a API e aparece no cabeçalho', async () => {
    const urls: string[] = [];
    const preview = createPreviewFetch();
    const spy: typeof fetch = (input, init) => {
      urls.push(String(input));
      return preview(input, init);
    };
    setup(<TeamSquad teamId={PREVIEW_IDS.team} season={2025} />, 'pt-BR', spy);
    expect(await screen.findByText('Elenco · 12 jogadores · Temporada 2025')).toBeTruthy();
    expect(urls.some((u) => u.includes('/squad?') && u.includes('season=2025'))).toBe(true);
  });

  it('textos em espanhol e inglês', async () => {
    const { container, unmount } = setup(<TeamSquad teamId={PREVIEW_IDS.team} />, 'es');
    await screen.findByText('Rafael Moura');
    expect(groupTitles(container)[0]).toBe('Arqueros');
    expect(screen.getByText('Plantel · 12 jugadores')).toBeTruthy();
    unmount();
    const en = setup(<TeamSquad teamId={PREVIEW_IDS.team} />, 'en');
    await screen.findByText('Rafael Moura');
    expect(groupTitles(en.container).at(-1)).toBe('Coaches');
    expect(en.container.textContent).toContain('Brazil · Age 31');
  });

  it('time sem elenco: mensagem de vazio', async () => {
    const empty: typeof fetch = async (input) => {
      const url = String(input);
      const body = url.includes('/squad')
        ? { team_id: 'x', season: null, players: [], coaches: [], staff: [] }
        : { type: 'about:blank', title: 'x', status: 404, code: 'NOT_FOUND' };
      return new Response(JSON.stringify(body), {
        status: url.includes('/squad') ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      });
    };
    setup(<TeamSquad teamId={PREVIEW_IDS.team} />, 'pt-BR', empty);
    expect(await screen.findByText('Elenco indisponível.')).toBeTruthy();
  });

  it('catálogo e opções: só futebol, time obrigatório, opções guardam só o que difere do padrão', () => {
    const entry = WIDGET_CATALOG.team_squad;
    expect(entry.sports).toEqual(['football']);
    expect(entry.requiredProps).toEqual(['teamId']);
    expect(parseWidgetOptions('team_squad', { showPhotos: true, showAge: false, season: '2024' })).toEqual({
      showAge: false,
      season: 2024,
    });
  });
});
