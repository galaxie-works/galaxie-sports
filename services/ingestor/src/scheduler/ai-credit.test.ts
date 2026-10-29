import { describe, expect, it, vi } from 'vitest';
import { checkAiCredit } from './ai-credit.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('checkAiCredit (mesma checagem do deploy.sh)', () => {
  it('sem chave do provedor efetivo: aviso, sem chamada', async () => {
    const fetch = vi.fn();
    expect(await checkAiCredit({ AI_PROVIDER: 'openai' }, fetch)).toEqual({
      status: 'warn',
      detail: { code: 'no_key', provider: 'openai', model: 'gpt-6-luna' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('IA desligada (AI_STATUS=off): aviso ai_off, sem chamar o provedor', async () => {
    const fetch = vi.fn();
    expect(await checkAiCredit({ AI_STATUS: 'off', OPENAI_API_KEY: 'sk' }, fetch)).toEqual({
      status: 'warn',
      detail: { code: 'ai_off', provider: 'openai', model: 'gpt-6-luna' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('OpenAI com crédito: chamada mínima ao modelo leve', async () => {
    const fetch = vi.fn(async () => json(200, { id: 'r' }));
    const r = await checkAiCredit({ OPENAI_API_KEY: 'sk', AI_MODEL_LIGHT: 'gpt-x' }, fetch);
    expect(r).toEqual({ status: 'pass', detail: { code: 'ok', provider: 'openai', model: 'gpt-x' } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'gpt-x', input: 'ok', max_output_tokens: 16 });
  });

  it('conta sem crédito: falha com o código do provedor', async () => {
    const fetch = vi.fn(async () => json(429, { error: { code: 'insufficient_quota' } }));
    expect(await checkAiCredit({ OPENAI_API_KEY: 'sk' }, fetch)).toMatchObject({
      status: 'fail',
      detail: { code: 'http', http: 429, error: 'insufficient_quota', reason: 'no_credit' },
    });
  });

  it('sem crédito pela mensagem (Gemini pré-pago, Anthropic) ou 402: falha', async () => {
    const gemini = vi.fn(async () =>
      json(429, {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'Your prepayment credits are depleted. Please go to AI Studio to manage your billing.',
        },
      }),
    );
    expect(await checkAiCredit({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' }, gemini)).toMatchObject({
      status: 'fail',
      detail: { http: 429, error: 'RESOURCE_EXHAUSTED', reason: 'no_credit' },
    });
    const anthropic = vi.fn(async () =>
      json(400, {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Your credit balance is too low to access the API.',
        },
      }),
    );
    expect(
      await checkAiCredit({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, anthropic),
    ).toMatchObject({ status: 'fail', detail: { http: 400, reason: 'no_credit' } });
    const paymentRequired = vi.fn(async () => json(402, {}));
    expect(await checkAiCredit({ OPENAI_API_KEY: 'sk' }, paymentRequired)).toMatchObject({
      status: 'fail',
      detail: { http: 402, reason: 'no_credit' },
    });
  });

  it('chave recusada (401/403): falha; erro do provedor e 400 comum: aviso', async () => {
    const denied = vi.fn(async () => json(403, { error: { code: 403, status: 'PERMISSION_DENIED' } }));
    expect(await checkAiCredit({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' }, denied)).toMatchObject({
      status: 'fail',
      detail: { http: 403, reason: 'auth' },
    });
    const down = vi.fn(async () => json(503, { error: { code: 503, status: 'UNAVAILABLE' } }));
    const r = await checkAiCredit({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' }, down);
    expect(r.status).toBe('warn');
    expect(r.detail.reason).toBeUndefined();
    const bad = vi.fn(async () =>
      json(400, { error: { type: 'invalid_request_error', message: 'bad model' } }),
    );
    expect((await checkAiCredit({ OPENAI_API_KEY: 'sk' }, bad)).status).toBe('warn');
  });

  it('Anthropic usa a própria chave e o modelo leve dela; falha de rede vira aviso', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const r = await checkAiCredit(
      { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'sk' },
      fetch,
    );
    expect(r).toMatchObject({
      status: 'warn',
      detail: { code: 'network', provider: 'anthropic', model: 'claude-haiku-5-5' },
    });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('Gemini usa GEMINI_API_KEY e o modelo leve dele; limite de taxa (429 sem sinal de billing) é aviso', async () => {
    const fetch = vi.fn(async () => json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }));
    const r = await checkAiCredit(
      { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'sk' },
      fetch,
    );
    expect(r).toEqual({
      status: 'warn',
      detail: {
        code: 'http',
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        http: 429,
        error: 'RESOURCE_EXHAUSTED',
      },
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('g');
  });
});
