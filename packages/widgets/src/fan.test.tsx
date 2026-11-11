import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THEMES,
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
});
