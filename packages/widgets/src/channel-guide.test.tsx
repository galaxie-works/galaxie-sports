import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type GsChannelGuide, type GsEvent } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch, createPreviewFixtures } from './fixtures.js';
import { optionProps, parseChannelNames, parseWidgetOptions, publicWidgetOptions } from './options.js';
import { buildRegistryItem } from './registry/build-registry-item.js';
import { ChannelGuide } from './widgets/channel-guide.js';

afterEach(cleanup);

function setup(ui: ReactNode, fetchImpl: typeof fetch = createPreviewFetch()) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale="pt-BR"
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={fetchImpl}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

/** fetch que responde a grade com o corpo dado e guarda as URLs pedidas. */
function guideFetch(body: Partial<GsChannelGuide>, calls: string[] = []): typeof fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const full: GsChannelGuide = {
      widget_id: PREVIEW_IDS.channelGuideWidget,
      date: '2026-11-08',
      country: 'BR',
      status: 'ok',
      channels: [],
      entries: [],
      ...body,
    };
    return new Response(JSON.stringify(full), { headers: { 'content-type': 'application/json' } });
  };
}

const sample = (): GsEvent[] => createPreviewFixtures(new Date()).events;

describe('grade nos canais do cliente', () => {
  it('chama a rota presa ao widget com o dia e os esportes, e agrupa por horário com os canais', async () => {
    const calls: string[] = [];
    const events = sample().slice(0, 2);
    const { container } = setup(
      <ChannelGuide widgetId={PREVIEW_IDS.channelGuideWidget} sport="football,basketball" />,
      guideFetch(
        {
          channels: ['Canal Aberto HD', 'Esporte Total 1'],
          entries: [
            { event: events[0]!, channels: ['Canal Aberto HD'] },
            { event: events[1]!, channels: ['Canal Aberto HD', 'Esporte Total 1'] },
          ],
        },
        calls,
      ),
    );
    expect(await screen.findByText('Hoje nos seus canais')).toBeTruthy();
    // o título sai antes da grade: espera os jogos chegarem
    await screen.findByText('Esporte Total 1');
    const url = new URL(calls[0]!);
    expect(url.pathname).toBe(`/v1/widgets/${PREVIEW_IDS.channelGuideWidget}/channel-guide`);
    expect(url.searchParams.get('sport')).toBe('football,basketball');
    expect(url.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tags = [...container.querySelectorAll('[data-tag=channel]')].map((t) => t.textContent);
    expect(tags).toEqual(['Canal Aberto HD', 'Canal Aberto HD', 'Esporte Total 1']);
    expect(container.querySelectorAll('[data-gs-slot]').length).toBeGreaterThan(0);
  });

  it('por canal: um grupo por canal da grade, com os jogos dele', async () => {
    const events = sample().slice(0, 2);
    const { container } = setup(
      <ChannelGuide widgetId="w" groupBy="channel" />,
      guideFetch({
        channels: ['Canal Aberto HD', 'Esporte Total 1'],
        entries: [
          { event: events[0]!, channels: ['Canal Aberto HD'] },
          { event: events[1]!, channels: ['Canal Aberto HD', 'Esporte Total 1'] },
        ],
      }),
    );
    await screen.findByText('Esporte Total 1');
    const groups = [...container.querySelectorAll('[data-gs-channel]')];
    expect(groups.map((g) => g.getAttribute('data-gs-channel'))).toEqual([
      'Canal Aberto HD',
      'Esporte Total 1',
    ]);
    expect(groups[0]!.querySelectorAll('[data-gs-event]')).toHaveLength(2);
    expect(groups[1]!.querySelectorAll('[data-gs-event]')).toHaveLength(1);
    // os canais já estão no cabeçalho do grupo
    expect(container.querySelectorAll('[data-tag=channel]')).toHaveLength(0);
  });

  it('sem lista confirmada ou sem jogos: o aviso de cada caso', async () => {
    setup(<ChannelGuide widgetId="w" />, guideFetch({ status: 'no_channel_list' }));
    expect(await screen.findByText(/lista de canais for confirmada/)).toBeTruthy();
    cleanup();
    setup(<ChannelGuide widgetId="w" day="tomorrow" />, guideFetch({ date: '2099-01-01' }));
    expect(await screen.findByText('Nenhum jogo nos seus canais neste dia.')).toBeTruthy();
  });

  it('prévia do Builder: os jogos de exemplo em canais fictícios', async () => {
    const { container } = setup(<ChannelGuide {...WIDGET_CATALOG.channel_guide.exampleProps} />);
    await screen.findByText('Hoje nos seus canais');
    await screen.findAllByText('Play Esportes');
    expect(container.querySelectorAll('[data-gs-event]').length).toBeGreaterThan(0);
  });

  it('opções: os canais escolhidos ficam salvos, mas não saem na página nem no registry', () => {
    const saved = parseWidgetOptions('channel_guide', {
      day: 'tomorrow',
      groupBy: 'time', // padrão: sai
      channels: ' SporTV HD \nGlobo SP HD\n\nSporTV HD',
    });
    expect(saved).toEqual({ day: 'tomorrow', channels: 'Globo SP HD\nSporTV HD' });
    expect(parseChannelNames(saved!.channels)).toEqual(['Globo SP HD', 'SporTV HD']);
    expect(publicWidgetOptions('channel_guide', saved)).toEqual({ day: 'tomorrow' });
    expect(optionProps('channel_guide', saved)).not.toHaveProperty('channels');

    const item = buildRegistryItem({
      kind: 'channel_guide',
      name: 'Grade Operadora',
      theme: DEFAULT_THEMES.dark,
      apiBaseUrl: 'https://api.exemplo.test',
      options: saved,
      defaults: { sport: 'football' },
      widgetId: PREVIEW_IDS.channelGuideWidget,
    });
    const file = item.files[1]!.content;
    expect(file).toContain(`"widgetId":"${PREVIEW_IDS.channelGuideWidget}"`);
    expect(file).toContain('"sport":"football"');
    expect(file).not.toContain('SporTV');
    expect(file).toContain('export function GalaxieChannelGuide(');
  });
});
