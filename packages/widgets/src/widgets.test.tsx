import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_THEMES, PUBLISHABLE_KEY_HEADER, eventRefreshMs, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider, needsPublishableKey } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch, createPreviewFixtures } from './fixtures.js';
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

  it('jogo agendado longe: acorda na janela de 30 min do início em vez de parar', async () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    const at = (min: number) => ({
      status: 'scheduled' as const,
      starts_at: new Date(now + min * 60_000).toISOString(),
    });
    expect(eventRefreshMs(at(10), now)).toBe(60_000);
    expect(eventRefreshMs(at(150), now)).toBe(120 * 60_000);
    expect(eventRefreshMs(at(30), now)).toBe(60_000);
    expect(eventRefreshMs(at(3 * 24 * 60), now)).toBe(6 * 60 * 60_000); // teto de 6 h
    expect(eventRefreshMs({ status: 'scheduled', starts_at: 'sem data' }, now)).toBeNull();
    expect(eventRefreshMs({ status: 'postponed', starts_at: at(150).starts_at }, now)).toBeNull();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = setup(<MatchCard eventId={PREVIEW_IDS.scheduledEvent} />); // começa em 150 min
    await screen.findByText('Serra');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(119 * 60_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('entidade some das props: limpa o placar antigo', async () => {
    const fetchImpl = vi.fn(createPreviewFetch());
    const props = {
      baseUrl: 'https://api.exemplo.test',
      publishableKey: 'pk_test_exemplo',
      theme: DEFAULT_THEMES.dark,
      locale: 'pt-BR' as const,
      fetch: fetchImpl,
    };
    const { rerender } = render(
      <GalaxieWidgetProvider {...props}>
        <MatchCard eventId={PREVIEW_IDS.liveEvent} />
      </GalaxieWidgetProvider>,
    );
    expect(await screen.findByText('2 – 1')).toBeTruthy();
    rerender(
      <GalaxieWidgetProvider {...props}>
        <MatchCard eventId="" />
      </GalaxieWidgetProvider>,
    );
    expect(screen.queryByText('2 – 1')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
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

describe('proxy no backend da operadora (sem chave)', () => {
  it('base na mesma origem ou relativa dispensa a chave; outra origem exige', () => {
    expect(needsPublishableKey('/api/galaxie', 'https://app.exemplo.com')).toBe(false);
    expect(needsPublishableKey('https://app.exemplo.com/api/galaxie', 'https://app.exemplo.com')).toBe(false);
    expect(needsPublishableKey('https://api.galaxie.sports', 'https://app.exemplo.com')).toBe(true);
    expect(needsPublishableKey('//api.galaxie.sports', 'https://app.exemplo.com')).toBe(true);
    expect(needsPublishableKey('https://api.galaxie.sports', undefined)).toBe(true);
  });

  it('chama o proxy sem o header da chave publicável', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(createPreviewFetch());
    render(
      <GalaxieWidgetProvider baseUrl="/api/galaxie" theme={DEFAULT_THEMES.light} locale="pt-BR">
        <MatchCard eventId={PREVIEW_IDS.liveEvent} />
      </GalaxieWidgetProvider>,
    );
    expect(await screen.findByText('2 – 1')).toBeTruthy();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`^/api/galaxie/v1/events/${PREVIEW_IDS.liveEvent}\\?`));
    expect(init?.headers).toEqual({ accept: 'application/json' });
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
  const wtwWith = (patch: object) => {
    const base = createPreviewFixtures().whereToWatch;
    return vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...base, ...patch }));
  };

  it('agrupa em TV aberta, canais pagos e cartões por plataforma com o plano', async () => {
    const { container, fetchImpl } = setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="br" />);
    expect(await screen.findByText('Disponível também em')).toBeTruthy();
    expect(screen.getByText('TV aberta')).toBeTruthy();
    expect(screen.getByText('Canais pagos')).toBeTruthy();
    expect(container.querySelector('[data-gs-group="free_tv"]')!.textContent).toContain('TV Exemplo');
    const cards = container.querySelectorAll('.gs-platform');
    expect(cards).toHaveLength(3);
    const operator = within(cards[0] as HTMLElement);
    expect(operator.getByText('Operadora Exemplo')).toBeTruthy();
    expect(operator.getByText('Operadora de TV paga')).toBeTruthy();
    expect(operator.getByText('Plano Completo')).toBeTruthy();
    expect(operator.getByText('Incluso')).toBeTruthy();
    expect(operator.getByText('Adicional')).toBeTruthy();
    // canais do plano e streamings inclusos
    expect(operator.getAllByText('Esporte Exemplo 2')).toHaveLength(2);
    expect(operator.getByText('Streamings inclusos')).toBeTruthy();
    // o streaming da opção publicada virou cartão (com o link de assistir), sem repetir solto
    const play = within(cards[2] as HTMLElement);
    expect(play.getByText('Streaming')).toBeTruthy();
    const link = play.getByRole('link', { name: 'Assistir' });
    expect(link.getAttribute('href')).toBe('https://example.com/assistir');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(container.querySelector('.gs-tiles [data-gs-group]')).toBeNull();
    expect(container.querySelectorAll('[data-gs-medium]')).toHaveLength(0);
    expect(String(vi.mocked(fetchImpl).mock.calls[0]![0])).toMatch(/where-to-watch\?.*country=BR/);
  });

  it('resposta sem o bloco availability: as opções por mídia, com o link de assistir', async () => {
    const { container } = setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />, {
      fetchImpl: wtwWith({ availability: undefined }),
    });
    expect(await screen.findByText('Operadora Exemplo Play')).toBeTruthy();
    expect(screen.getByText('TV por assinatura')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Assistir' }).getAttribute('href')).toBe(
      'https://example.com/assistir',
    );
    expect(container.querySelectorAll('[data-gs-medium]')).toHaveLength(3);
    expect(container.querySelector('.gs-platform')).toBeNull();
  });

  it('canal do jogo: "Passa em" antes; encerrado "Transmitido por" ou "Não confirmamos", sem "sai mais perto"', async () => {
    const base = createPreviewFixtures().whereToWatch;
    const pre = setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />);
    expect(await screen.findByText('Passa em Exemplo Play')).toBeTruthy();
    expect(pre.container.querySelector('[data-gs-match-channel="confirmed"]')).toBeTruthy();
    pre.unmount();

    const post = setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />, {
      fetchImpl: wtwWith({
        availability: {
          ...base.availability!,
          match_channel: {
            ...base.availability!.match_channel!,
            phase: 'post',
            channels: [
              {
                ...base.availability!.match_channel!.channels[0]!,
                source: { publisher: 'exemplo.test', url: 'https://exemplo.test/escala', kind: 'official' },
              },
            ],
          },
        },
      }),
    });
    expect(await screen.findByText('Transmitido por Exemplo Play')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fonte: exemplo.test' }).getAttribute('href')).toBe(
      'https://exemplo.test/escala',
    );
    post.unmount();

    const none = setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />, {
      fetchImpl: wtwWith({
        status: 'unknown',
        options: [],
        availability: {
          ...base.availability!,
          channel_status: 'to_confirm',
          match_channel: { phase: 'post', state: 'not_confirmed', headline: '', hint: null, channels: [] },
        },
      }),
    });
    expect(await screen.findByText('Não confirmamos o canal deste jogo')).toBeTruthy();
    expect(none.container.textContent).not.toContain('sai mais perto da partida');
  });

  it('canal a confirmar: aviso e os cartões das plataformas dos detentores, sem link', async () => {
    const base = createPreviewFixtures().whereToWatch;
    const { container } = setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />, {
      fetchImpl: wtwWith({
        status: 'unknown',
        options: [],
        to_confirm: [
          {
            provider: 'Canal Esporte Exemplo',
            provider_id: 'esporte_exemplo',
            medium: 'pay_tv',
            access_model: 'subscription',
            logo: null,
            logo_dark: null,
            sources: [],
          },
        ],
        availability: {
          ...base.availability!,
          free_tv: [],
          platforms: base.availability!.platforms.slice(0, 2),
          channel_status: 'to_confirm',
          match_channel: { phase: 'pre', state: 'to_confirm', headline: '', hint: null, channels: [] },
        },
      }),
    });
    expect(await screen.findByText('Canal deste jogo a confirmar')).toBeTruthy();
    expect(container.querySelector('[data-gs-to-confirm]')).toBeTruthy();
    expect(container.querySelector('[data-gs-group="pay_tv"] [data-to-confirm]')).toBeTruthy();
    expect(container.querySelectorAll('.gs-platform')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Assistir' })).toBeNull();
  });

  it('operadora do tenant: selo, e o aviso quando o jogo não está na grade dela', async () => {
    const base = createPreviewFixtures().whereToWatch;
    const mine = base.availability!.platforms[0]!;
    const { container } = setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />, {
      fetchImpl: wtwWith({
        availability: {
          ...base.availability!,
          platforms: base.availability!.platforms.slice(1),
          your_operator: { ...mine, plans: [] },
        },
      }),
    });
    expect(await screen.findByText('Sua operadora')).toBeTruthy();
    expect(container.querySelector('.gs-platform[data-mine]')!.textContent).toContain(
      'Este jogo não está na grade da sua operadora.',
    );
  });

  it('crédito do logo da plataforma: visível quando a licença exige', async () => {
    const base = createPreviewFixtures().whereToWatch;
    const [first, ...rest] = base.availability!.platforms;
    const credit = {
      text: 'Logo: Fulano / Wikimedia Commons · CC BY-SA 4.0',
      page_url: 'https://commons.wikimedia.org/wiki/File:Exemplo.svg',
      attribution_required: true,
    };
    setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />, {
      fetchImpl: wtwWith({
        availability: {
          ...base.availability!,
          platforms: [{ ...first!, platform: { ...first!.platform, logo_credit: credit } }, ...rest],
        },
      }),
    });
    const link = await screen.findByRole('link', { name: credit.text });
    expect(link.getAttribute('href')).toBe(credit.page_url);
  });

  it.each([
    ['en', 'Also available on', 'Pay TV operator'],
    ['es', 'Disponible también en', 'Operadora de TV paga'],
  ] as const)('%s', async (locale, alsoOn, kind) => {
    setup(<WhereToWatch eventId={PREVIEW_IDS.liveEvent} market="BR" />, { locale });
    expect(await screen.findByText(alsoOn)).toBeTruthy();
    expect(screen.getByText(kind)).toBeTruthy();
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
