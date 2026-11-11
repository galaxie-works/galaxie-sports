/** Desligado no painel, o servidor recusa o envio; ligado, o ajuste é lido a cada envio, sem cache entre eles. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readFeedbackSettings = vi.fn();
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth/server', () => ({
  auth: { api: { getSession: async () => ({ user: { id: 'u1', role: 'admin' } }) } },
  isAccessExpired: () => false,
}));
vi.mock('@/lib/auth/roles', () => ({ roleOf: () => 'admin' }));
vi.mock('@/lib/client/tenants', () => ({ getTenantInfo: async () => null, isUuid: () => false }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));
vi.mock('./attachments', () => ({
  attachmentStoreConfigured: () => true,
  deleteAttachment: vi.fn(),
  putAttachment: vi.fn(),
}));
vi.mock('./image', () => ({ cleanImage: vi.fn() }));
vi.mock('./settings-db', () => ({ readFeedbackSettings: () => readFeedbackSettings() }));
vi.mock('@/lib/notifications/store', () => ({ recordFeedbackIssue: vi.fn(async () => {}) }));

const { sendFeedback } = await import('./actions');

function form() {
  const f = new FormData();
  f.set('subject', 'bug');
  f.set('message', 'Uma mensagem longa o bastante para passar na validação.');
  return f;
}

const fetchMock = vi.fn();
const configured = {
  enabled: true,
  tokenUnreadable: false,
  tokenInPanel: true,
  token: 'token-a',
  repo: 'o/r',
  config: { token: 'token-a', repo: 'o/r' },
};

beforeEach(() => {
  fetchMock.mockReset();
  readFeedbackSettings.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('BETTER_AUTH_SECRET', 's'.repeat(32));
  vi.stubEnv('BETTER_AUTH_URL', 'https://demo.example');
});

describe('sendFeedback', () => {
  it('desligado: recusa sem chamar o GitHub', async () => {
    readFeedbackSettings.mockResolvedValue({ ...configured, enabled: false });
    expect(await sendFeedback(form())).toEqual({ ok: false, error: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem conseguir ler o ajuste, não envia', async () => {
    readFeedbackSettings.mockRejectedValue(new Error('db fora'));
    expect(await sendFeedback(form())).toEqual({ ok: false, error: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem token nem repo: indisponível', async () => {
    readFeedbackSettings.mockResolvedValue({ ...configured, config: null });
    expect(await sendFeedback(form())).toEqual({ ok: false, error: 'unavailable' });
  });

  it('token trocado no painel vale no envio seguinte, sem reiniciar', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/issues')) return new Response(JSON.stringify({ number: 1 }), { status: 201 });
      if (url.includes('/labels/')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ private: true, auth: init.headers }), { status: 200 });
    });
    const tokens = () =>
      fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>);

    readFeedbackSettings.mockResolvedValue(configured);
    expect(await sendFeedback(form())).toEqual({ ok: true });
    expect(tokens().at(-1)!.authorization).toBe('Bearer token-a');

    readFeedbackSettings.mockResolvedValue({
      ...configured,
      token: 'token-b',
      config: { token: 'token-b', repo: 'o/r' },
    });
    expect(await sendFeedback(form())).toEqual({ ok: true });
    expect(tokens().at(-1)!.authorization).toBe('Bearer token-b');
  });
});
