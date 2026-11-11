/** "Testar antes de salvar" (#1087): a chamada barata de cada provedor, a chave só em cabeçalho, prazo curto. */
import { describe, expect, it, vi } from 'vitest';

import { isTestableSecret, testSecretValue } from './secret-tests';

const VALUE = 'chave-candidata-1234567890';
const respond = (status: number, body: unknown = {}) =>
  vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body), { status }));
const call = (f: ReturnType<typeof respond>) => f.mock.calls[0] as unknown as [string, RequestInit];

describe('provedores com teste', () => {
  it.each([
    ['APISPORTS_KEY', 'https://v3.football.api-sports.io/status', 'x-apisports-key', VALUE],
    ['OPENAI_API_KEY', 'https://api.openai.com/v1/models', 'authorization', `Bearer ${VALUE}`],
    ['ANTHROPIC_API_KEY', 'https://api.anthropic.com/v1/models?limit=1', 'x-api-key', VALUE],
    [
      'GEMINI_API_KEY',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      'x-goog-api-key',
      VALUE,
    ],
    ['DEEPSEEK_API_KEY', 'https://api.deepseek.com/models', 'authorization', `Bearer ${VALUE}`],
    [
      'YOUTUBE_API_KEY',
      'https://www.googleapis.com/youtube/v3/videos?part=id&id=jNQXAC9IVRw',
      'x-goog-api-key',
      VALUE,
    ],
    ['STRIPE_SECRET_KEY', 'https://api.stripe.com/v1/balance', 'authorization', `Bearer ${VALUE}`],
    ['COSMOS_OPENAI_API_KEY', 'https://api.openai.com/v1/models', 'authorization', `Bearer ${VALUE}`],
    ['COSMOS_ANTHROPIC_API_KEY', 'https://api.anthropic.com/v1/models?limit=1', 'x-api-key', VALUE],
    [
      'COSMOS_GEMINI_API_KEY',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      'x-goog-api-key',
      VALUE,
    ],
    ['COSMOS_DEEPSEEK_API_KEY', 'https://api.deepseek.com/models', 'authorization', `Bearer ${VALUE}`],
  ])('%s: chamada barata, chave só no cabeçalho', async (key, url, header, sent) => {
    const f = respond(200, { response: { requests: { current: 1 } }, errors: [] });
    expect(await testSecretValue(key, VALUE, f as unknown as typeof fetch)).toBe('ok');
    const [calledUrl, init] = call(f);
    expect(calledUrl).toBe(url);
    expect(calledUrl).not.toContain(VALUE);
    expect((init.headers as Record<string, string>)[header]).toBe(sent);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sem teste: SMTP, S3, token das sugestões, chaves só do .env', async () => {
    for (const key of [
      'SMTP_PASSWORD',
      'S3_SECRET_KEY',
      'FEEDBACK_GITHUB_TOKEN',
      'SETTINGS_KEK',
      'BETTER_AUTH_SECRET',
    ]) {
      expect(isTestableSecret(key)).toBe(false);
      expect(await testSecretValue(key, VALUE, respond(200) as unknown as typeof fetch)).toBeNull();
    }
  });
});

describe('resultado', () => {
  it('401, 403 e 400 (chave do Google inválida) = recusada; 5xx e rede = fora do ar', async () => {
    const t = (f: unknown) => testSecretValue('OPENAI_API_KEY', VALUE, f as typeof fetch);
    expect(await t(respond(401))).toBe('rejected');
    expect(await t(respond(403))).toBe('rejected');
    expect(await t(respond(400))).toBe('rejected');
    expect(await t(respond(503))).toBe('unreachable');
    expect(
      await t(
        vi.fn(async () => {
          throw new DOMException('timeout', 'TimeoutError');
        }),
      ),
    ).toBe('unreachable');
  });

  it('api-sports responde 200 com `errors` para chave errada', async () => {
    const f = respond(200, { errors: { token: 'Error/Missing application key.' } });
    expect(await testSecretValue('APISPORTS_KEY', VALUE, f as unknown as typeof fetch)).toBe('rejected');
  });

  it('o prazo curto aborta a chamada', async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
        ),
    );
    expect(await testSecretValue('OPENAI_API_KEY', VALUE, hang as unknown as typeof fetch, 20)).toBe(
      'unreachable',
    );
  });
});
