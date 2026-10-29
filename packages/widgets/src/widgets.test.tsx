import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_THEMES, PUBLISHABLE_KEY_HEADER, eventRefreshMs, type WidgetLocale } from './core/model.js';
import { GalaxieWidgetProvider, needsPublishableKey } from './core/react.js';
import { PREVIEW_IDS, createPreviewFetch, createPreviewFixtures } from './fixtures.js';
import { AiContext } from './widgets/ai-context.js';
import { HeadToHead } from './widgets/head-to-head.js';
import { LiveList } from './widgets/live-list.js';
import { MatchCard } from './widgets/match-card.js';
import { MatchStakes } from './widgets/match-stakes.js';
import { RelatedVideos } from './widgets/related-videos.js';
import { StandingsTable } from './widgets/standings-table.js';
import { TeamSchedule } from './widgets/team-schedule.js';
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
    // com id: até 2 min antes, sempre o mesmo para o mesmo jogo, diferente entre jogos da rodada
    const wakes = ['e1', 'e2', 'e3', 'e4'].map((id) => eventRefreshMs({ ...at(150), id }, now)!);
    for (const w of wakes) expect(w).toBeGreaterThan(118 * 60_000);
    for (const w of wakes) expect(w).toBeLessThanOrEqual(120 * 60_000);
    expect(new Set(wakes).size).toBeGreaterThan(1);
    expect(eventRefreshMs({ ...at(150), id: 'e1' }, now)).toBe(wakes[0]);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = setup(<MatchCard eventId={PREVIEW_IDS.scheduledEvent} />); // começa em 150 min
    await screen.findByText('Serra');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(117 * 60_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
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
    const https = { href: 'https://app.exemplo.com/jogos', origin: 'https://app.exemplo.com' };
    const http = { href: 'http://app.exemplo.com/jogos', origin: 'http://app.exemplo.com' };
    expect(needsPublishableKey('/api/galaxie', https)).toBe(false);
    expect(needsPublishableKey('api/galaxie', https)).toBe(false);
    expect(needsPublishableKey('https://app.exemplo.com/api/galaxie', https)).toBe(false);
    expect(needsPublishableKey('https://api.galaxie.sports', https)).toBe(true);
    expect(needsPublishableKey('//api.galaxie.sports', https)).toBe(true);
    // formatos que o fetch resolve para outra origem
    expect(needsPublishableKey(' https://api.galaxie.sports', https)).toBe(true);
    expect(needsPublishableKey('\\\\api.galaxie.sports', https)).toBe(true);
    expect(needsPublishableKey('https:api.galaxie.sports', http)).toBe(true);
    // ...e para a mesma origem
    expect(needsPublishableKey('\\api', https)).toBe(false);
    expect(needsPublishableKey('https:api', https)).toBe(false);
    // proxy num subdomínio é outra origem: continua exigindo a chave
    expect(needsPublishableKey('https://api.exemplo.com/galaxie', https)).toBe(true);
    expect(needsPublishableKey('/api/galaxie', null)).toBe(true); // fora do navegador
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

/** fetch dos dados de exemplo com uma rota trocada (`path` termina a URL). */
const overriding =
  (suffix: string, body: unknown, status = 200): typeof fetch =>
  async (input, init) => {
    const url = new URL(String(input));
    return url.pathname.endsWith(suffix) ? jsonResponse(body, status) : createPreviewFetch()(input, init);
  };

describe('AiContext', () => {
  it('antes do jogo: o cenário, com os times e o aviso de texto feito com IA', async () => {
    const { fetchImpl } = setup(<AiContext eventId={PREVIEW_IDS.scheduledEvent} />);
    expect(await screen.findByText(/assume a liderança se vencer o clássico/)).toBeTruthy();
    expect(screen.getByText('Antes do jogo')).toBeTruthy();
    expect(await screen.findByText(/Serra x Litoral/)).toBeTruthy();
    expect(screen.getByText(/gerado com IA/)).toBeTruthy();
    const urls = vi.mocked(fetchImpl).mock.calls.map(([u]) => new URL(String(u)).pathname);
    expect(urls).toContain(`/v1/events/${PREVIEW_IDS.scheduledEvent}/context`);
  });

  it('jogo encerrado: abre no resumo e o torcedor alterna para o cenário', async () => {
    setup(<AiContext eventId={PREVIEW_IDS.finishedEvent} />);
    expect(await screen.findByText(/está na final/)).toBeTruthy();
    const scenario = screen.getByRole('button', { name: 'Antes do jogo' });
    expect(screen.getByRole('button', { name: 'Depois do jogo' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(scenario);
    expect(screen.getByText(/decidem a vaga na final/)).toBeTruthy();
    expect(scenario.getAttribute('aria-pressed')).toBe('true');
  });

  it('sem texto gerado ainda: o vazio; sem o módulo: o aviso de 403', async () => {
    setup(<AiContext eventId="0199a5c0-0000-7000-8000-00000000ffff" />);
    expect(await screen.findByText(/sai mais perto da partida/)).toBeTruthy();
    cleanup();
    const forbidden = { title: 'Módulo fora do plano', status: 403, code: 'MODULE_NOT_IN_PLAN' };
    setup(<AiContext eventId={PREVIEW_IDS.liveEvent} />, {
      fetchImpl: vi.fn(overriding('/context', forbidden, 403)),
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/não libera este conteúdo/);
  });
});

describe('MatchStakes', () => {
  it('por time: as tags do torcedor, o que está em jogo e o grito da torcida, com o clássico no topo', async () => {
    const { container } = setup(<MatchStakes eventId={PREVIEW_IDS.scheduledEvent} />);
    expect(await screen.findByText('Na briga pelo título')).toBeTruthy();
    expect(screen.getByText(/Clássico · Clássico da Serra/)).toBeTruthy();
    const home = container.querySelector('[data-gs-side=home]')!;
    const away = container.querySelector('[data-gs-side=away]')!;
    expect(home.textContent).toContain('Com vitória, assume a liderança');
    expect(home.textContent).toContain('Vamos, Serra!');
    expect(away.textContent).toContain('Precisa pontuar para sair do Z-4');
    expect(away.textContent).toContain('Contra o rebaixamento');
    // stake dos dois lados aparece nos dois
    expect(home.textContent).toContain('melhor campanha no clássico');
    expect(away.textContent).toContain('melhor campanha no clássico');
  });

  it('sem stakes, tags nem grito: o vazio', async () => {
    setup(<MatchStakes eventId={PREVIEW_IDS.liveEvent} />);
    expect(await screen.findByText('Nada decisivo em jogo nesta partida.')).toBeTruthy();
  });
});

describe('RelatedVideos', () => {
  it('miniaturas com o tipo, a duração e o canal, pedindo o país do mercado', async () => {
    const { fetchImpl, container } = setup(<RelatedVideos eventId={PREVIEW_IDS.finishedEvent} limit={4} />);
    expect(await screen.findByText(/melhores momentos$/)).toBeTruthy();
    expect(container.querySelectorAll('.gs-video')).toHaveLength(4);
    expect(screen.getByText('8:32')).toBeTruthy();
    expect(screen.getByText('Pênaltis')).toBeTruthy();
    const url = new URL(String(vi.mocked(fetchImpl).mock.calls[0]![0]));
    expect(url.pathname).toBe(`/v1/events/${PREVIEW_IDS.finishedEvent}/related`);
    expect(url.searchParams.get('country')).toBe('BR');
    expect(url.searchParams.get('limit')).toBe('4');
  });

  it('toca no player oficial (só YouTube https) e fecha; outro endereço vira link externo', async () => {
    const base = createPreviewFixtures().related;
    const [a, b] = base.data;
    const body = {
      ...base,
      data: [
        { ...a!, embed_url: 'https://www.youtube.com/embed/abc' },
        { ...b!, embed_url: 'https://evil.example/embed/x', url: 'https://www.youtube.com/watch?v=x' },
      ],
    };
    const { container } = setup(<RelatedVideos eventId={PREVIEW_IDS.finishedEvent} />, {
      fetchImpl: vi.fn(overriding('/related', body)),
    });
    fireEvent.click(await screen.findByRole('button', { name: `Assistir: ${a!.title}` }));
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('src')).toBe('https://www.youtube.com/embed/abc?autoplay=1&rel=0');
    const link = screen.getByRole('link', { name: `Assistir: ${b!.title}` });
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=x');
    expect(link.getAttribute('rel')).toContain('noopener');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar vídeo' }));
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('sem vídeos: o vazio', async () => {
    setup(<RelatedVideos eventId={PREVIEW_IDS.liveEvent} />, {
      fetchImpl: vi.fn(overriding('/related', { event_id: 'x', data: [], counts: {}, updated_at: null })),
    });
    expect(await screen.findByText(/aparecem aqui assim que saírem/)).toBeTruthy();
  });
});

describe('HeadToHead', () => {
  it('histórico geral do clássico quando há, e os últimos confrontos', async () => {
    const { container } = setup(<HeadToHead eventId={PREVIEW_IDS.scheduledEvent} limit={3} />);
    expect(await screen.findByText('Histórico geral: 214 jogos')).toBeTruthy();
    const stats = [...container.querySelectorAll('.gs-stat strong')].map((n) => n.textContent);
    expect(stats).toEqual(['88', '61', '65']);
    expect(screen.getByText('Clássico da Serra')).toBeTruthy();
    expect(container.querySelectorAll('.gs-fixture')).toHaveLength(3);
    expect(container.querySelector('.gs-fixture')!.textContent).toContain('1 – 2');
  });

  it('sem histórico curado: o recorte da base, desde o ano do primeiro jogo', async () => {
    const base = createPreviewFixtures().h2h;
    setup(<HeadToHead eventId={PREVIEW_IDS.scheduledEvent} />, {
      fetchImpl: vi.fn(overriding('/h2h', { ...base, all_time: null })),
    });
    expect(await screen.findByText(`5 jogos desde ${base.summary.since}`)).toBeTruthy();
  });

  it('times que nunca se enfrentaram: o vazio', async () => {
    const base = createPreviewFixtures().h2h;
    setup(<HeadToHead eventId={PREVIEW_IDS.scheduledEvent} />, {
      fetchImpl: vi.fn(
        overriding('/h2h', {
          ...base,
          all_time: null,
          summary: { ...base.summary, since: null, played: 0, draws: 0, teams: [] },
          events: [],
        }),
      ),
    });
    expect(await screen.findByText('Os times ainda não se enfrentaram.')).toBeTruthy();
  });
});

describe('TeamSchedule', () => {
  it('próximos jogos (o ao vivo primeiro) e os últimos resultados com V/E/D, do mais recente', async () => {
    const { fetchImpl, container } = setup(<TeamSchedule teamId={PREVIEW_IDS.team} />);
    expect(await screen.findByText('Próximos jogos')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Clube Aurora' })).toBeTruthy();
    const [next, recent] = container.querySelectorAll('.gs-group');
    const nextRows = next!.querySelectorAll('.gs-fixture');
    expect(nextRows).toHaveLength(3);
    expect(nextRows[0]!.textContent).toContain('Estrela');
    expect(nextRows[0]!.textContent).toContain('2 – 1');
    expect(nextRows[1]!.textContent).toContain('Planalto');
    const results = [...recent!.querySelectorAll('.gs-result')].map((n) => n.textContent);
    expect(results).toEqual(['V', 'E', 'D']);
    const url = new URL(String(vi.mocked(fetchImpl).mock.calls[0]![0]));
    expect(url.pathname).toBe(`/v1/teams/${PREVIEW_IDS.team}/events`);
    expect(url.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(url.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('com jogo ao vivo atualiza a cada 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchImpl } = setup(<TeamSchedule teamId={PREVIEW_IDS.team} />);
    await screen.findByText('Próximos jogos');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['en', 'Upcoming matches', ['W', 'D', 'L']],
    ['es', 'Próximos partidos', ['G', 'E', 'P']],
  ] as const)('%s', async (locale, title, letters) => {
    const { container } = setup(<TeamSchedule teamId={PREVIEW_IDS.team} />, { locale });
    expect(await screen.findByText(title)).toBeTruthy();
    expect([...container.querySelectorAll('.gs-result')].map((n) => n.textContent)).toEqual(letters);
  });
});
