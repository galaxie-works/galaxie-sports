import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/builder/store', () => ({ builderDb: vi.fn() }));

import { quotaScopes } from './quota-data';

describe('salas oferecidas para cota (#1116)', () => {
  it('produtos primeiro, depois as salas sem repetir e só no formato aceito', () => {
    expect(
      quotaScopes(['chat:r2', 'community:c1'], ['chat:r2', 'chat:r1', 'shop:x', 'pool', 'bad scope']),
    ).toEqual(['chat', 'community', 'pool', 'chat:r1', 'chat:r2', 'community:c1']);
  });
});
