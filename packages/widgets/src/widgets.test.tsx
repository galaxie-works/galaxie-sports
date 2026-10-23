import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_THEMES, PUBLISHABLE_KEY_HEADER, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch } from './fixtures.js';
import { LiveList } from './widgets/live-list.js';
import { MatchCard } from './widgets/match-card.js';
import { StandingsTable } from './widgets/standings-table.js';
import { WhereToWatch } from './widgets/where-to-watch.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(
  ui: ReactNode,
  {
    fetchImpl = vi.fn(createPreviewFetch()),
    locale = 'pt-BR',
    publishableKey = 'pk_test_exemplo',
  }: { fetchImpl?: typeof fetch; locale?: WidgetLocale; publishableKey?: string } = {},
) {
  const view = render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test/"
      publishableKey={publishableKey}
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

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('MatchCard', () => {
  it('mostra escudos, placar, minuto ao vivo e competição, com a chave publicável no header', async () => {
    const { fetchImpl } = setup(<MatchCard eventId={PREVIEW_IDS.liveEvent} />);
    expect(screen.getByRole('status')).toBeTruthy(); // carregando
    expect(await screen.findByText('2 – 1')).toBeTruthy();
    expect(screen.getByText('Aurora')).toBeTruthy();
    expect(screen.getByText('Estrela')).toBeTruthy();
    expect(screen.getByText("67'")).toBeTruthy();
    expect(screen.getByText(/Liga Exemplo · Rodada 12/)).toBeTruthy();

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(String(url)).toMatch(
      new RegExp(
        `^https://api\\.exemplo\\.test/v1/events/${PREVIEW_IDS.liveEvent}\\?locale=pt-BR&tz=America%2FSao_Paulo$`,
      ),
    );
    expect((init?.headers as Record<string, string>)[PUBLISHABLE_KEY_HEADER]).toBe('pk_test_exemplo');
  });

  it('faz polling leve enquanto o jogo está ao vivo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = setup(<MatchCard eventId={PREVIEW_IDS.liveEvent} />);
    await screen.findByText('2 – 1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('não faz polling num jogo encerrado e mostra os pênaltis', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = setup(<MatchCard eventId={PREVIEW_IDS.finishedEvent} />);
    expect(await screen.findByText('Encerrado')).toBeTruthy();
    expect(screen.getByText(/4 – 3 pên\./)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('mostra o erro e tenta de novo', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ title: 'falhou' }, 500))
      .mockImplementation(createPreviewFetch());
    setup(<MatchCard eventId={PREVIEW_IDS.liveEvent} />, { fetchImpl });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível carregar/);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('2 – 1')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('avisa quando falta a chave publicável, sem chamar a API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(
      <GalaxieWidgetProvider
        baseUrl="https://api.exemplo.test"
        publishableKey=""
        theme={DEFAULT_THEMES.light}
        locale="en"
      >
        <MatchCard eventId={PREVIEW_IDS.liveEvent} />
      </GalaxieWidgetProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/publishable key/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('LiveList', () => {
  it('lista os jogos do dia agrupados por competição', async () => {
    const { container, fetchImpl } = setup(<LiveList sport="football" />);
    expect(await screen.findByText('Clube Aurora')).toBeTruthy();
    expect(screen.getByText('Jogos do dia')).toBeTruthy();
    expect(screen.getByText('Liga Exemplo')).toBeTruthy();
    expect(container.querySelectorAll('[data-gs-event]')).toHaveLength(3);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toMatch(
      /\/v1\/events\?.*sport=football&date=\d{4}-\d{2}-\d{2}&limit=30/,
    );
  });

  it('com date="live" mostra só os jogos ao vivo', async () => {
    const { container, fetchImpl } = setup(<LiveList date="live" />, { locale: 'es' });
    expect(await screen.findByText('En vivo ahora')).toBeTruthy();
    await screen.findByText('Clube Aurora');
    expect(container.querySelectorAll('[data-gs-event]')).toHaveLength(1);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toMatch(/\/v1\/events\/live\?locale=es-AR/);
  });

  it('mostra o vazio quando não há jogo', async () => {
    setup(<LiveList date="live" />, {
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] })),
    });
    expect(await screen.findByText('Nenhum jogo ao vivo agora.')).toBeTruthy();
  });
});

describe('StandingsTable', () => {
  it('desenha a classificação com a zona marcada', async () => {
    const { container, fetchImpl } = setup(<StandingsTable competitionId={PREVIEW_IDS.competition} />);
    expect(await screen.findByText('Aurora')).toBeTruthy();
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(6);
    expect(within(rows[0] as HTMLElement).getByText('26')).toBeTruthy(); // 8V 2E = 26 pontos
    expect(container.querySelectorAll('[data-zone]')).toHaveLength(2);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toContain(
      `/v1/competitions/${PREVIEW_IDS.competition}/seasons/current/standings`,
    );
  });

  it('mostra o vazio sem linhas', async () => {
    const empty = {
      competition_id: 'x',
      season: { year: 2026, label: '2026' },
      groups: [],
      updated_at: null,
    };
    setup(<StandingsTable competitionId="x" season={2026} />, {
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(empty)),
    });
    expect(await screen.findByText('A tabela ainda não está disponível.')).toBeTruthy();
  });
});

describe('WhereToWatch', () => {
  it('agrupa as opções por mídia, com o link de assistir', async () => {
    const { container, fetchImpl } = setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="br" />);
    expect(await screen.findByText('Operadora Exemplo Play')).toBeTruthy();
    expect(screen.getByText('TV aberta')).toBeTruthy();
    expect(screen.getByText('TV por assinatura')).toBeTruthy();
    expect(screen.getByText('Esporte Exemplo 2')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Assistir' });
    expect(link.getAttribute('href')).toBe('https://example.com/assistir');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(container.querySelectorAll('[data-gs-medium]')).toHaveLength(3);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toMatch(/where-to-watch\?.*country=BR/);
  });

  it('explica o 403 (chave sem o módulo) e não oferece tentar de novo', async () => {
    const forbidden = { title: 'Módulo fora do plano', status: 403, code: 'MODULE_NOT_IN_PLAN' };
    setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />, {
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(forbidden, 403)),
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/não libera este conteúdo/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('mostra a mensagem quando a transmissão não está confirmada', async () => {
    const unknown = {
      event_id: PREVIEW_IDS.liveEvent,
      country: 'BR',
      status: 'unknown',
      message: null,
      options: [],
      to_confirm: [],
      updated_at: null,
    };
    setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />, {
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(unknown)),
    });
    expect(await screen.findByText('Transmissão ainda não confirmada.')).toBeTruthy();
  });
});
