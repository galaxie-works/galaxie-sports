import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { parseWidgetOptions } from './options.js';
import { buildRegistryItem } from './registry/build-registry-item.js';
import { Sidelined } from './widgets/sidelined.js';

afterEach(() => cleanup());

const NOW = new Date('2026-11-06T15:00:00Z');

function setup(
  ui: ReactNode,
  { fetchImpl = vi.fn(createPreviewFetch({ now: NOW })), locale = 'pt-BR' as WidgetLocale } = {},
) {
  const view = render(
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
  return { ...view, fetchImpl };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Sidelined', () => {
  it('por jogo: os dois times, com motivo, previsão de volta e fora/dúvida', async () => {
    const { container, fetchImpl } = setup(<Sidelined eventId={PREVIEW_IDS.scheduledEvent} />);
    expect(await screen.findByText('Rafael Moura')).toBeTruthy();
    const url = String(vi.mocked(fetchImpl).mock.calls[0]![0]);
    expect(url).toContain(`/v1/events/${PREVIEW_IDS.scheduledEvent}/sidelined`);
    expect(container.querySelector('[data-gs-sidelined=event]')).toBeTruthy();
    expect(container.querySelectorAll('.gs-group')).toHaveLength(2);
    expect(screen.getByText('Lesão na coxa (posterior) · Volta prevista: 18/11/26')).toBeTruthy();
    expect(screen.getByText('Cartões amarelos · Sem previsão de volta')).toBeTruthy();
    expect(screen.getAllByText('Fora')).toHaveLength(3);
    expect(screen.getAllByText('Dúvida')).toHaveLength(2);
  });

  it('por time: a lista dele, com o nome no título', async () => {
    const { fetchImpl } = setup(<Sidelined teamId={PREVIEW_IDS.team} />);
    expect(await screen.findByText('Rafael Moura')).toBeTruthy();
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toContain(
      `/v1/teams/${PREVIEW_IDS.team}/sidelined`,
    );
    expect(screen.getByRole('heading').textContent).toMatch(/^Desfalques · /);
  });

  it('opções: sem dúvidas, sem motivo, sem foto e com limite por time', async () => {
    const { container } = setup(
      <Sidelined
        eventId={PREVIEW_IDS.scheduledEvent}
        showDoubtful={false}
        showReason={false}
        showPhoto={false}
        limit={1}
      />,
    );
    expect(await screen.findByText('Rafael Moura')).toBeTruthy();
    expect(screen.queryByText('Dúvida')).toBeNull();
    expect(screen.queryByText(/Lesão na coxa/)).toBeNull();
    expect(screen.getByText('Volta prevista: 18/11/26')).toBeTruthy();
    expect(container.querySelectorAll('[data-gs-sidelined-player]')).toHaveLength(2);
    expect(container.querySelector('[data-gs-sidelined-player] .gs-crest')).toBeNull();
  });

  it('lista ainda não publicada: avisa em vez de dizer "nenhum desfalque"', async () => {
    const fetchImpl = vi.fn(async () => json({ event_id: 'x', available: false, teams: [] }));
    setup(<Sidelined eventId="x" />, { fetchImpl: fetchImpl as unknown as typeof fetch, locale: 'es' });
    expect(await screen.findByText('La lista de bajas todavía no salió.')).toBeTruthy();
  });

  it('time sem desfalques e sem entidade escolhida', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        team: { id: 't', name: 'Aurora', side: null, logo: null },
        as_of: '2026-11-06',
        next_event_id: null,
        players: [],
      }),
    );
    setup(<Sidelined teamId="t" />, { fetchImpl: fetchImpl as unknown as typeof fetch, locale: 'en' });
    expect(await screen.findByText('No absences reported.')).toBeTruthy();
    cleanup();
    setup(<Sidelined />);
    expect(screen.getByText('Escolha um jogo ou um time.')).toBeTruthy();
  });
});

describe('catálogo e opções', () => {
  it('Desfalques é só do futebol, por jogo ou por time, nos três idiomas', () => {
    const entry = WIDGET_CATALOG.sidelined;
    expect(entry.sports).toEqual(['football']);
    expect(entry.requiredProps).toEqual([]);
    expect(entry.optionalProps).toEqual(expect.arrayContaining(['eventId', 'teamId']));
    expect(Object.keys(entry.name).sort()).toEqual(['en', 'es', 'pt-BR']);
  });

  it('guarda só o que difere do padrão e limita o número', () => {
    expect(parseWidgetOptions('sidelined', { showReason: true, showDoubtful: false, limit: '99' })).toEqual({
      showDoubtful: false,
      limit: 40,
    });
  });
});

describe('registry', () => {
  const base = {
    kind: 'sidelined' as const,
    name: 'Desfalques',
    theme: DEFAULT_THEMES.light,
    apiBaseUrl: 'https://api.test',
  };

  it('grava o jogo salvo no Builder; sem jogo, o time', () => {
    const byEvent = buildRegistryItem({ ...base, defaults: { eventId: 'jogo', teamId: 'time' } });
    expect(byEvent.files[1]!.content).toContain(
      'const GALAXIE_DEFAULTS: Partial<SidelinedProps> = {"eventId":"jogo"};',
    );
    const byTeam = buildRegistryItem({ ...base, defaults: { teamId: 'time' } });
    expect(byTeam.files[1]!.content).toContain(
      'const GALAXIE_DEFAULTS: Partial<SidelinedProps> = {"teamId":"time"};',
    );
    expect(byTeam.files[1]!.content).toContain('export function GalaxieSidelined(');
  });
});
