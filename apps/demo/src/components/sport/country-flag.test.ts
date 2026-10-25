import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flagsQuery } from './country-flag';

const flags = { BR: '/flags/br.svg' };

/** Monta a query como o ExampleProvider deixa o cache e devolve quantas vezes ela foi ao fetch. */
async function mountAfter(ms: number, inExample: boolean) {
  const client = new QueryClient();
  client.setQueryDefaults(['navigation-flags'], { initialData: flags, staleTime: Infinity });
  // primeira montagem, para a query existir no cache com o initialData
  const first = new QueryObserver(client, flagsQuery('pt-BR', inExample));
  first.subscribe(() => {})();
  vi.advanceTimersByTime(ms);
  // CountryFlag remontado depois de `ms`
  const again = new QueryObserver(client, flagsQuery('pt-BR', inExample));
  const unsubscribe = again.subscribe(() => {});
  await vi.runOnlyPendingTimersAsync();
  unsubscribe();
  client.clear();
}

describe('flagsQuery', () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ countries: [] })));

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('no exemplo, não chama a API nem depois de 1 hora', async () => {
    await mountAfter(2 * 60 * 60 * 1000, true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fora do exemplo, as bandeiras vencem em 1 hora e são buscadas de novo', async () => {
    await mountAfter(2 * 60 * 60 * 1000, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
