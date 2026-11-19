import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDemoKeyAccess, demoKeyAccess } from './demo-modules';

const account = (modules: string[]) =>
  Response.json({
    tenant: { id: 't1', slug: 'demo', name: 'Demo', modules },
    key: { id: 'k1', prefix: 'abc', scopes: null, effectiveModules: modules },
  });

beforeEach(() => {
  clearDemoKeyAccess();
  vi.stubEnv('GALAXIE_DEMO_KEY', 'gs_demo_chave');
});
afterEach(() => vi.unstubAllEnvs());

describe('demoKeyAccess (#1389)', () => {
  it('lê os módulos que a chave da demo libera em /v1/account, com a chave no header', async () => {
    const fetchImpl = vi.fn(async () => account(['core_data', 'live_chat']));
    const out = await demoKeyAccess(() => 0, fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ tenantId: 't1', tenantName: 'Demo', modules: ['core_data', 'live_chat'] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/account$/);
    expect(new Headers(init.headers).get('x-galaxie-key')).toBe('gs_demo_chave');
  });

  it('guarda por 60 s; depois, lê de novo', async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => account(['core_data']));
    const f = fetchImpl as unknown as typeof fetch;
    await demoKeyAccess(() => now, f);
    now = 59_000;
    await demoKeyAccess(() => now, f);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 61_000;
    await demoKeyAccess(() => now, f);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('pedidos ao mesmo tempo fazem uma leitura só', async () => {
    const fetchImpl = vi.fn(async () => account(['core_data']));
    const f = fetchImpl as unknown as typeof fetch;
    await Promise.all([demoKeyAccess(() => 0, f), demoKeyAccess(() => 0, f)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['403', async () => new Response(null, { status: 403 })],
    ['API fora do ar', async () => Promise.reject(new TypeError('fetch failed'))],
    ['resposta sem a lista', async () => Response.json({ tenant: { id: 't1', name: 'Demo' }, key: {} })],
    [
      'resposta sem o tenant',
      async () => Response.json({ key: { effectiveModules: ['core_data', 'live_chat'] } }),
    ],
  ])('%s: null, e tenta de novo em 15 s', async (_, impl) => {
    let now = 0;
    const fetchImpl = vi.fn(impl);
    const f = fetchImpl as unknown as typeof fetch;
    expect(await demoKeyAccess(() => now, f)).toBeNull();
    now = 14_000;
    await demoKeyAccess(() => now, f);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 16_000;
    await demoKeyAccess(() => now, f);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sem a chave da demo, nem pergunta à API', async () => {
    vi.stubEnv('GALAXIE_DEMO_KEY', '');
    const fetchImpl = vi.fn();
    expect(await demoKeyAccess(() => 0, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
