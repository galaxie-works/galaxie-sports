import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { resolveEmbed, type EmbedConfig } from './embed/element.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { createPlayerFixture } from './fixtures-player.js';
import { optionProps, parseWidgetOptions } from './options.js';
import { buildRegistryItem } from './registry/build-registry-item.js';
import { PlayerProfile } from './widgets/player-profile.js';

afterEach(cleanup);

const NOW = new Date('2026-11-06T12:00:00Z');

function setup(
  ui: ReactNode,
  fetchImpl: typeof fetch = createPreviewFetch({ now: NOW }),
  locale: WidgetLocale = 'pt-BR',
) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale={locale}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={fetchImpl}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

const blocks = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-gs-block]')].map((b) => b.getAttribute('data-gs-block'));

describe('Ficha do jogador', () => {
  it('cabeçalho com clube atual, posição e idade; números da temporada e todos os blocos', async () => {
    const { container } = setup(<PlayerProfile personId={PREVIEW_IDS.person} />);
    expect(await screen.findByText('Rafael Tavares')).toBeTruthy();
    expect(screen.getByText('Brasil · Atacante · #9 · 26 anos')).toBeTruthy();
    expect(container.querySelector('[data-gs-current-team]')?.textContent).toContain('Clube Aurora');
    expect(screen.getByText('Temporada 2026')).toBeTruthy();
    const stats = [...container.querySelectorAll('.gs-stat')].map((s) => s.textContent);
    expect(stats).toEqual([
      '24Jogos',
      '14Gols',
      '7Assistências',
      '1872Minutos',
      '4Amarelos',
      '0Vermelhos',
      '7.2Nota',
    ]);
    expect(blocks(container)).toEqual(['stats', 'clubs', 'seasons', 'trophies', 'transfers']);
    expect(screen.getByText('Campeão')).toBeTruthy();
    expect(screen.getByText('Empréstimo', { exact: false })).toBeTruthy();
    expect(screen.getByText('Atual')).toBeTruthy();
  });

  it('blocos desligados não aparecem e o limite corta as listas', async () => {
    const { container } = setup(
      <PlayerProfile
        personId={PREVIEW_IDS.person}
        showStats={false}
        showTrophies={false}
        showTransfers={false}
        limit={2}
      />,
    );
    await screen.findByText('Rafael Tavares');
    expect(blocks(container)).toEqual(['clubs', 'seasons']);
    const clubs = container.querySelector('[data-gs-block="clubs"]')!;
    expect(clubs.querySelectorAll('.gs-fixture')).toHaveLength(2);
    expect(clubs.textContent).toContain('e mais 1');
    const seasons = container.querySelector('[data-gs-block="seasons"]')!;
    expect(seasons.textContent).toContain('e mais 2');
  });

  it('pede a temporada escolhida à API e destaca o ano', async () => {
    const preview = createPreviewFetch({ now: NOW });
    const fetchMock = vi.fn<typeof fetch>((input, init) => preview(input, init));
    const { container } = setup(<PlayerProfile personId={PREVIEW_IDS.person} season={2024} />, fetchMock);
    expect(await screen.findByText('Temporada 2024')).toBeTruthy();
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe(`/v1/people/${PREVIEW_IDS.person}/overview`);
    expect(url.searchParams.get('season')).toBe('2024');
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('2024');
  });

  it('técnico: só os jogos comandados, sem gols', async () => {
    const coach = { ...createPlayerFixture(NOW), role: 'coach', position: null, number: null };
    const fetchImpl: typeof fetch = async () => Response.json(coach);
    const { container } = setup(<PlayerProfile personId={PREVIEW_IDS.person} />, fetchImpl);
    await screen.findByText('Rafael Tavares');
    expect(screen.getByText('Brasil · Técnico · 26 anos')).toBeTruthy();
    expect([...container.querySelectorAll('.gs-stat')].map((s) => s.textContent)).toEqual(['24Jogos']);
    expect(container.querySelector('[data-gs-block="seasons"]')!.textContent).not.toContain('gols');
  });

  it('textos em inglês e espanhol', async () => {
    setup(<PlayerProfile personId={PREVIEW_IDS.person} />, undefined, 'en');
    expect(await screen.findByText('2026 season')).toBeTruthy();
    expect(screen.getByText('Brasil · Forward · #9 · 26 years old')).toBeTruthy();
    cleanup();
    setup(<PlayerProfile personId={PREVIEW_IDS.person} />, undefined, 'es');
    expect(await screen.findByText('Brasil · Delantero · #9 · 26 años')).toBeTruthy();
    expect(screen.getByText('Transferencias')).toBeTruthy();
  });

  it('jogador inexistente mostra o erro da API', async () => {
    setup(<PlayerProfile personId="0199a5c0-0000-7000-8000-00000000ffff" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('Ficha do jogador no catálogo, nas opções, no embed e no registry', () => {
  it('é um tipo só do futebol, com o jogador obrigatório', () => {
    expect(WIDGET_CATALOG.player_profile.sports).toEqual(['football']);
    expect(WIDGET_CATALOG.player_profile.requiredProps).toEqual(['personId']);
  });

  it('opções: blocos, temporada e limite; só o que difere do padrão', () => {
    expect(
      parseWidgetOptions('player_profile', {
        season: '2024',
        showTrophies: false,
        showStats: true,
        limit: 99,
        outra: 1,
      }),
    ).toEqual({ season: 2024, showTrophies: false, limit: 30 });
    expect(optionProps('player_profile', { showTransfers: false })).toEqual({ showTransfers: false });
  });

  it('embed: o jogador salvo ou o do atributo person-id', () => {
    const config = {
      id: 'w',
      kind: 'player_profile',
      version: 1,
      theme: DEFAULT_THEMES.dark,
      locale: 'pt-BR',
      market: 'BR',
      defaults: { personId: 'salvo' },
      apiBaseUrl: 'https://api.exemplo.test',
    } satisfies EmbedConfig;
    expect(resolveEmbed(config).personId).toBe('salvo');
    expect(resolveEmbed(config, { personId: 'outro' }).personId).toBe('outro');
  });

  it('registry: o jogador vira a prop padrão do componente instalado', () => {
    const item = buildRegistryItem({
      kind: 'player_profile',
      name: 'Ficha do camisa 9',
      theme: DEFAULT_THEMES.dark,
      apiBaseUrl: 'https://api.exemplo.test',
      defaults: { personId: PREVIEW_IDS.person, teamId: 'ignorado' },
      options: { showTransfers: false },
    });
    const file = item.files[1]!.content;
    expect(file).toContain('export function GalaxiePlayerProfile(');
    expect(file).toContain(`"personId":"${PREVIEW_IDS.person}"`);
    expect(file).toContain('"showTransfers":false');
    expect(file).not.toContain('ignorado');
  });
});
