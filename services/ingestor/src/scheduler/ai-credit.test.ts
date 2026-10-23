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

  it('OpenAI com crédito: chamada mínima ao modelo leve', async () => {
    const fetch = vi.fn(async () => json(200, { id: 'r' }));
    const r = await checkAiCredit({ OPENAI_API_KEY: 'sk', AI_MODEL_LIGHT: 'gpt-x' }, fetch);
    expect(r).toEqual({ status: 'pass', detail: { code: 'ok', provider: 'openai', model: 'gpt-x' } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'gpt-x', input: 'ok', max_output_tokens: 16 });
  });

  it('conta sem crédito: aviso com o código do provedor', async () => {
    const fetch = vi.fn(async () => json(429, { error: { code: 'insufficient_quota' } }));
    expect(await checkAiCredit({ OPENAI_API_KEY: 'sk' }, fetch)).toMatchObject({
      status: 'warn',
      detail: { code: 'http', http: 429, error: 'insufficient_quota' },
    });
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
});
