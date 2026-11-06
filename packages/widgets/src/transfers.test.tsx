import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from './catalog.js';
import { DEFAULT_THEMES, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { optionProps, parseWidgetOptions } from './options.js';
import { buildRegistryItem } from './registry/index.js';
import { TransferMarket } from './widgets/transfer-market.js';

afterEach(cleanup);

const NOW = new Date('2026-11-06T15:00:00Z');

function setup(ui: ReactNode, locale: WidgetLocale = 'pt-BR', calls: string[] = []) {
  const preview = createPreviewFetch({ now: NOW });
  const fetchSpy: typeof fetch = (input, init) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return preview(input, init);
  };
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey="pk_test_exemplo"
      theme={DEFAULT_THEMES.dark}
      locale={locale}
      market="BR"
      timeZone="America/Sao_Paulo"
      fetch={fetchSpy}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
}

const names = (root: ParentNode) =>
  [...root.querySelectorAll('.gs-fixture .gs-strong')].map((n) => n.textContent);

describe('vai e vem do mercado', () => {
  it('do time: chegadas e saídas separadas, com clube, tipo e data', async () => {
    const calls: string[] = [];
    const { container } = setup(<TransferMarket teamId={PREVIEW_IDS.team} />, 'pt-BR', calls);
    expect(await screen.findByText('Mercado · Clube Aurora')).toBeTruthy();
    expect(screen.getByText('Chegadas')).toBeTruthy();
    expect(screen.getByText('Saídas')).toBeTruthy();
    const ins = container.querySelectorAll('[data-gs-direction=in]');
    const outs = container.querySelectorAll('[data-gs-direction=out]');
    expect([...ins].map((li) => li.querySelector('.gs-strong')!.textContent)).toEqual([
      'Rafael Monteiro',
      'Lucas Fontoura',
      'Matheus Viana',
    ]);
    expect(outs).toHaveLength(2);
    expect(ins[0]!.textContent).toContain('de Porto Atlântico FC · Empréstimo');
    expect(ins[0]!.textContent).toContain('03/11/26');
    expect(outs[0]!.textContent).toContain('para Dínamo do Leste · € 4.2M');
    expect(ins[2]!.textContent).toContain('Volta de empréstimo');
    expect(calls[0]).toContain(`/v1/teams/${PREVIEW_IDS.team}/transfers?`);
    expect(calls[0]).toContain('direction=all');
    expect(calls[0]).toContain('days=180');
    expect(calls[0]).toContain('limit=10');
  });

  it('só saídas, período curto, sem data, sem tipo e numa lista só', async () => {
    const { container } = setup(
      <TransferMarket
        teamId={PREVIEW_IDS.team}
        direction="out"
        days={30}
        showType={false}
        showDate={false}
        groupByDirection={false}
      />,
    );
    expect(await screen.findByText('Diego Albuquerque')).toBeTruthy();
    expect(names(container)).toEqual(['Diego Albuquerque']);
    expect(container.textContent).not.toContain('€');
    expect(container.querySelector('time')).toBeNull();
    expect(screen.queryByText('Saídas')).toBeNull();
  });

  it('do campeonato: origem → destino e troca interna como chegada; limite', async () => {
    const { container } = setup(
      <TransferMarket competitionId="liga-exemplo" limit={4} groupByDirection={false} />,
    );
    expect(await screen.findByText('Mercado · Liga Exemplo')).toBeTruthy();
    const rows = container.querySelectorAll('.gs-fixture');
    expect(rows).toHaveLength(4);
    // Matheus Viana: Estrela do Sul → Clube Aurora, os dois da liga
    const viana = [...rows].find((r) => r.textContent?.includes('Matheus Viana'))!;
    expect(viana.getAttribute('data-gs-direction')).toBe('in');
    expect(viana.textContent).toContain('Estrela do Sul→Clube Aurora');
  });

  it('sem time nem campeonato pede a escolha, sem chamar a API', () => {
    const calls: string[] = [];
    setup(<TransferMarket />, 'pt-BR', calls);
    expect(screen.getByText('Escolha um time ou um campeonato.')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('vazio no período e textos em inglês e espanhol', async () => {
    setup(<TransferMarket teamId={PREVIEW_IDS.team} direction="in" days={1} />, 'en');
    expect(await screen.findByText('No transfers in this period.')).toBeTruthy();
    cleanup();
    setup(<TransferMarket teamId={PREVIEW_IDS.team} />, 'es');
    expect(await screen.findByText('Llegadas')).toBeTruthy();
    expect(screen.getByText(/de Porto Atlântico FC · Préstamo/)).toBeTruthy();
  });

  it('opções: só as do tipo, válidas e diferentes do padrão', () => {
    expect(
      parseWidgetOptions('transfer_market', {
        direction: 'in',
        days: 9999,
        limit: 10,
        showPhoto: false,
        other: true,
      }),
    ).toEqual({ direction: 'in', days: 730, showPhoto: false });
    expect(parseWidgetOptions('transfer_market', { direction: 'up' })).toBeUndefined();
    expect(optionProps('transfer_market', { groupByDirection: false })).toEqual({ groupByDirection: false });
  });

  it('catálogo e registry: componente instalável com o time ou o campeonato salvo', () => {
    const entry = WIDGET_CATALOG.transfer_market;
    expect(entry.registryComponent).toBe('GalaxieTransferMarket');
    expect(entry.optionalProps).toEqual(expect.arrayContaining(['teamId', 'competitionId']));
    const item = buildRegistryItem({
      kind: 'transfer_market',
      name: 'Mercado do Aurora',
      theme: DEFAULT_THEMES.light,
      apiBaseUrl: 'https://api.sports.galaxie.works',
      defaults: { competitionId: 'liga-exemplo' },
    });
    const widget = item.files.find((f) => !f.target.endsWith('galaxie-core.tsx'))!;
    expect(widget.content).toContain('export function GalaxieTransferMarket');
    expect(widget.content).toContain('liga-exemplo');
  });
});
