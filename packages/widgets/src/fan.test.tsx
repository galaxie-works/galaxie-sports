import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THEMES,
  FAN_TOKEN_CHANGED_EVENT,
  fanGateMessage,
  fanTokenExpiresAt,
  isFanToken,
  type FanCapability,
} from './core/model.js';
import { FanGate, GalaxieWidgetProvider, useFanSession } from './core/react.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFor = (tenant: string, exp = Math.floor(Date.now() / 1000) + 900) =>
  `gft_${b64({ v: 1, t: tenant, exp })}.assinatura`;

const CAPS: Record<string, FanCapability[]> = {
  under13: [],
  '13_17': ['read', 'predict'],
  '18plus': ['read', 'predict', 'write', 'redeem'],
};

/** API de mentira: token `gft_` do tenant `site` vale; de outro tenant, 401 (como a API real). */
function api(band: keyof typeof CAPS = '18plus') {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization') ?? '';
    const tenant = /"t":"([^"]+)"/.exec(
      atob(auth.slice('Bearer gft_'.length).split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/')),
    )?.[1];
    if (String(url).endsWith('/v1/fans/me')) {
      if (tenant !== 'site' || headers.get('x-galaxie-publishable-key') !== 'gs_pk_test_site')
        return new Response(JSON.stringify({ code: 'INVALID_KEY' }), { status: 401 });
      return new Response(
        JSON.stringify({
          data: {
            profile_id: 'p1',
            nickname: 'Tricolor_77',
            avatar_url: null,
            age_band: band,
            country: 'BR',
            locale: 'pt-BR',
            capabilities: CAPS[band],
          },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ok: tenant === 'site' }), { status: tenant === 'site' ? 200 : 401 });
  });
}

function setup(
  ui: ReactNode,
  props: Partial<Parameters<typeof GalaxieWidgetProvider>[0]> = {},
  fetchImpl = api(),
) {
  render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test"
      publishableKey="gs_pk_test_site"
      theme={DEFAULT_THEMES.light}
      locale="pt-BR"
      fetch={fetchImpl}
      {...props}
    >
      {ui}
    </GalaxieWidgetProvider>,
  );
  return fetchImpl;
}

describe('token do torcedor (modelo)', () => {
  it('lê a validade do corpo do token e recusa o que não é gft_', () => {
    expect(fanTokenExpiresAt(tokenFor('site', 1_800_000_000))).toBe(1_800_000_000_000);
    expect(fanTokenExpiresAt('gft_lixo.x')).toBeNull();
    expect(isFanToken('gs_sk_live_x')).toBe(false);
    expect(isFanToken(null)).toBe(false);
  });

  it('portão: sem token, faixa e capacidade', () => {
    expect(fanGateMessage('none', [], 'write')).toBe('signIn');
    expect(fanGateMessage('expired', [], 'read')).toBe('expired');
    expect(fanGateMessage('ready', CAPS['13_17']!, 'write')).toBe('readOnly');
    expect(fanGateMessage('ready', CAPS['13_17']!, 'predict')).toBeNull();
    expect(fanGateMessage('ready', CAPS.under13!, 'read')).toBe('restricted');
    expect(fanGateMessage('ready', CAPS['18plus']!, 'write')).toBeNull();
  });
});

describe('<FanGate> e a sessão do torcedor', () => {
  const Chat = () => (
    <FanGate>
      <button type="button">Enviar mensagem</button>
    </FanGate>
  );

  it('sem token: "entre para participar", com o botão quando o site passa onFanSignIn', async () => {
    const onFanSignIn = vi.fn();
    const fetchImpl = setup(<Chat />, { onFanSignIn });
    expect(await screen.findByText('Entre para participar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(onFanSignIn).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('18plus escreve; 13_17 só lê; under13 não usa', async () => {
    setup(<Chat />, { fanToken: tokenFor('site') });
    expect(await screen.findByRole('button', { name: 'Enviar mensagem' })).toBeTruthy();
    cleanup();
    setup(<Chat />, { fanToken: tokenFor('site') }, api('13_17'));
    expect(await screen.findByText(/podem ler e palpitar/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enviar mensagem' })).toBeNull();
    cleanup();
    setup(<Chat />, { fanToken: tokenFor('site') }, api('under13'));
    expect(await screen.findByText(/menores de 13 anos/)).toBeTruthy();
  });

  it('token de outro cliente é recusado: o widget não deixa participar', async () => {
    setup(<Chat />, { fanToken: tokenFor('outro') });
    expect(await screen.findByText(/sessão terminou/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enviar mensagem' })).toBeNull();
  });

  it('getFanToken vale mais que fanToken e renova um minuto antes de vencer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const now = Date.now();
    const getFanToken = vi.fn(async () => tokenFor('site', Math.floor(now / 1000) + 120));
    setup(<Chat />, { fanToken: tokenFor('outro'), getFanToken });
    expect(await screen.findByRole('button', { name: 'Enviar mensagem' })).toBeTruthy();
    expect(getFanToken).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(getFanToken).toHaveBeenCalledTimes(2);
  });

  it('fetch do torcedor leva o token, a chave do site e nenhum cookie', async () => {
    const getFanToken = vi.fn(async () => tokenFor('site'));
    const seen: number[] = [];
    function Probe() {
      const fan = useFanSession();
      return (
        <button
          type="button"
          onClick={() => void fan.fetch('/v1/fans/me/wallet').then((r) => seen.push(r.status))}
        >
          {fan.status}
        </button>
      );
    }
    const fetchImpl = setup(<Probe />, { getFanToken });
    fireEvent.click(await screen.findByRole('button', { name: 'ready' }));
    await waitFor(() => expect(seen).toEqual([200]));
    const last = fetchImpl.mock.calls.at(-1)!;
    expect(String(last[0])).toBe('https://api.exemplo.test/v1/fans/me/wallet');
    expect(new Headers(last[1]?.headers).get('x-galaxie-publishable-key')).toBe('gs_pk_test_site');
    expect(last[1]?.credentials).toBe('omit');
  });

  it('login sem recarregar: o evento do site faz o widget pedir o token de novo', async () => {
    let logged = false;
    const getFanToken = vi.fn(async () => (logged ? tokenFor('site') : null));
    setup(<Chat />, { getFanToken, onFanSignIn: () => {} });
    expect(await screen.findByText('Entre para participar.')).toBeTruthy();
    logged = true;
    act(() => {
      document.dispatchEvent(new Event(FAN_TOKEN_CHANGED_EVENT));
    });
    expect(await screen.findByRole('button', { name: 'Enviar mensagem' })).toBeTruthy();
  });

  it('token guardado e vencido na primeira conferência: pede outro uma vez e entra', async () => {
    const tokens = [tokenFor('outro'), tokenFor('site')];
    const getFanToken = vi.fn(async () => tokens.shift() ?? null);
    setup(<Chat />, { getFanToken });
    expect(await screen.findByRole('button', { name: 'Enviar mensagem' })).toBeTruthy();
    expect(getFanToken).toHaveBeenCalledTimes(2);
  });

  it('recusas ao mesmo tempo pedem um token só; caminho fora da API é recusado', async () => {
    let n = 0;
    const getFanToken = vi.fn(async () => (n++ === 0 ? tokenFor('site') : tokenFor('site', 1_900_000_000)));
    let fan: ReturnType<typeof useFanSession> | null = null;
    function Probe() {
      fan = useFanSession();
      return <span>{fan.status}</span>;
    }
    // a API recusa o token da primeira chamada à carteira
    const base = api();
    let refused = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/wallet') && refused++ < 3) return new Response(null, { status: 401 });
      return base(url, init);
    });
    setup(<Probe />, { getFanToken }, fetchImpl);
    await screen.findByText('ready');
    const before = getFanToken.mock.calls.length;
    await act(async () => {
      await Promise.all([1, 2, 3].map(() => fan!.fetch('/v1/fans/me/wallet')));
    });
    // as três recusas dividem um pedido de token
    expect(getFanToken.mock.calls.length - before).toBe(1);
    await expect(fan!.fetch('@evil.test/x')).rejects.toThrow(TypeError);
    await expect(fan!.fetch('//evil.test/x')).rejects.toThrow(TypeError);
    await expect(fan!.fetch('/\\evil.test/x')).rejects.toThrow(TypeError);
  });

  it('chave que não leva o torcedor (403): indisponível, sem pedir outro token', async () => {
    const getFanToken = vi.fn(async () => tokenFor('site'));
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ code: 'PUBLISHABLE_KEY_NOT_ALLOWED' }), { status: 403 }),
    );
    let status = '';
    function Probe() {
      status = useFanSession().status;
      return <span>{status}</span>;
    }
    setup(<Probe />, { getFanToken }, fetchImpl);
    expect(await screen.findByText('unavailable')).toBeTruthy();
    expect(getFanToken).toHaveBeenCalledTimes(1);
  });

  it('token fixo recusado no fetch: não repete com o mesmo token e a sessão termina', async () => {
    const token = tokenFor('site');
    let fan: ReturnType<typeof useFanSession> | null = null;
    function Probe() {
      fan = useFanSession();
      return <span>{fan.status}</span>;
    }
    const base = api();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).endsWith('/wallet') ? new Response(null, { status: 401 }) : base(url, init),
    );
    setup(<Probe />, { getFanToken: () => token }, fetchImpl);
    await screen.findByText('ready');
    await act(async () => {
      expect((await fan!.fetch('/v1/fans/me/wallet')).status).toBe(401);
    });
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).endsWith('/wallet'))).toHaveLength(1);
    expect(await screen.findByText('expired')).toBeTruthy();
  });

  it('logout com um pedido de token em voo: o refresh não aproveita o token de quem saiu', async () => {
    let logged = true;
    const slow: ((t: string | null) => void)[] = [];
    const getFanToken = vi.fn(() => {
      if (logged) return new Promise<string | null>((r) => slow.push(r));
      return null;
    });
    let fan: ReturnType<typeof useFanSession> | null = null;
    function Probe() {
      fan = useFanSession();
      return <span>{fan.status}</span>;
    }
    const fetchImpl = setup(<Probe />, { getFanToken });
    await waitFor(() => expect(slow).toHaveLength(1));
    logged = false;
    act(() => fan!.refresh());
    expect(await screen.findByText('none')).toBeTruthy();
    // o pedido antigo chega depois: não traz de volta o torcedor que saiu
    await act(async () => {
      slow[0]!(tokenFor('site'));
    });
    expect(screen.getByText('none')).toBeTruthy();
    // e o fetch do torcedor não usa o token de quem saiu
    const calls = fetchImpl.mock.calls.length;
    await act(async () => {
      expect((await fan!.fetch('/v1/fans/me/wallet')).status).toBe(401);
    });
    expect(fetchImpl.mock.calls.length).toBe(calls);
  });

  it('outro torcedor no mesmo widget: o Perfil anterior sai da tela enquanto confere', async () => {
    let who = 'p1';
    const tok = () => `gft_${b64({ v: 1, t: 'site', p: who, exp: Math.floor(Date.now() / 1000) + 900 })}.x`;
    const base = api();
    let fail = false;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (fail) throw new TypeError('rede fora');
      return base(url, init);
    });
    let fan: ReturnType<typeof useFanSession> | null = null;
    function Probe() {
      fan = useFanSession();
      return <span>{`${fan.status}:${fan.me?.nickname ?? '-'}`}</span>;
    }
    setup(<Probe />, { getFanToken: async () => tok() }, fetchImpl);
    expect(await screen.findByText('ready:Tricolor_77')).toBeTruthy();
    who = 'p2';
    fail = true;
    act(() => fan!.refresh());
    expect(await screen.findByText('unavailable:-')).toBeTruthy();
  });

  it('troca de torcedor durante a renovação de um fetch: o token antigo não volta', async () => {
    let who = 'A';
    const tok = (p: string, sig = p) =>
      `gft_${b64({ v: 1, t: 'site', p, exp: Math.floor(Date.now() / 1000) + 900 })}.${sig}`;
    const slow: ((t: string) => void)[] = [];
    let first = true;
    const getFanToken = vi.fn(() => {
      if (first) {
        first = false;
        return tok('A', 'A1');
      }
      // a renovação de A demora; depois do refresh, o site já é de B
      return who === 'A' ? new Promise<string>((r) => slow.push(r)) : tok('B');
    });
    const base = api();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).endsWith('/wallet') && new Headers(init?.headers).get('authorization')?.endsWith('.A1')
        ? new Response(null, { status: 401 })
        : base(url, init),
    );
    let fan: ReturnType<typeof useFanSession> | null = null;
    function Probe() {
      fan = useFanSession();
      return <span>{fan.status}</span>;
    }
    setup(<Probe />, { getFanToken }, fetchImpl);
    await screen.findByText('ready');
    let pending: Promise<Response> | null = null;
    act(() => {
      pending = fan!.fetch('/v1/fans/me/wallet');
    });
    await waitFor(() => expect(slow).toHaveLength(1));
    who = 'B';
    act(() => fan!.refresh());
    const authOf = (c: unknown[]) =>
      new Headers((c[1] as RequestInit | undefined)?.headers).get('authorization');
    // a conferência nova já foi como B
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some((c) => String(c[0]).endsWith('/v1/fans/me') && authOf(c)?.endsWith('.B')),
      ).toBe(true),
    );
    await screen.findByText('ready');
    let late: Response | null = null;
    await act(async () => {
      slow[0]!(tok('A', 'A2'));
      late = await pending;
    });
    // a renovação de antes do refresh não sai nem fica: a chamada pendente termina com a recusa
    expect(late!.status).toBe(401);
    expect(fetchImpl.mock.calls.some((c) => authOf(c)?.endsWith('.A2'))).toBe(false);
    // a próxima chamada vai como B
    await act(async () => {
      await fan!.fetch('/v1/fans/me/wallet');
    });
    expect(authOf(fetchImpl.mock.calls.at(-1)!)?.endsWith('.B')).toBe(true);
    expect(fetchImpl.mock.calls.some((c) => authOf(c)?.endsWith('.A2'))).toBe(false);
  });
});
