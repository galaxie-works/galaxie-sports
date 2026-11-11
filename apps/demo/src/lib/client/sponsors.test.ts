import { compileLists, DEFAULT_MODERATION_LISTS } from '@galaxie/engage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/auth/db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));
vi.mock('@/lib/engage/moderation-lists', () => ({
  compiledBaseLists: async () => compileLists(DEFAULT_MODERATION_LISTS),
}));

const { saveSponsor, archiveSponsor, SponsorError } = await import('./sponsors');

const TENANT = '0190a1b2-0000-7000-8000-000000000001';
const sponsor = {
  name: 'Cervejaria do Bairro',
  category: 'beverage',
  linkUrl: 'https://cervejaria.com.br',
  logoLightUrl: null,
  logoDarkUrl: null,
  countries: ['br'],
  startsAt: null,
  endsAt: null,
};
const row = {
  id: 'x',
  name: 'Cervejaria do Bairro',
  category: 'beverage',
  link_url: 'https://cervejaria.com.br/',
  logo_light_url: null,
  logo_dark_url: null,
  countries: ['BR'],
  starts_at: null,
  ends_at: null,
  archived_at: null,
  version: 1,
  updated_at: new Date('2026-11-11T00:00:00Z'),
};

beforeEach(() => query.mockReset());

describe('patrocinadores do cliente (#1021)', () => {
  it('casa de aposta não chega ao banco', async () => {
    await expect(
      saveSponsor({
        tenantId: TENANT,
        id: null,
        expectedVersion: null,
        sponsor: { ...sponsor, name: 'Betano' },
        actor: 'a',
      }),
    ).rejects.toMatchObject({ code: 'invalid', issues: [{ field: 'name', code: 'betting' }] });
    expect(query).not.toHaveBeenCalled();
  });

  it('cria com o tenant da sessão e o cadastro normalizado', async () => {
    query.mockResolvedValueOnce({ rows: [{ n: '0' }] }).mockResolvedValueOnce({ rows: [row] });
    const saved = await saveSponsor({
      tenantId: TENANT,
      id: null,
      expectedVersion: null,
      sponsor,
      actor: 'a',
    });
    expect(saved).toMatchObject({ name: 'Cervejaria do Bairro', countries: ['BR'], version: 1 });
    const [, params] = query.mock.calls[1]!;
    expect(params[0]).toBe(TENANT);
    expect(params[6]).toEqual(['BR']);
  });

  it('limite de ativos', async () => {
    query.mockResolvedValueOnce({ rows: [{ n: '200' }] });
    await expect(
      saveSponsor({ tenantId: TENANT, id: null, expectedVersion: null, sponsor, actor: 'a' }),
    ).rejects.toMatchObject({ code: 'limit' });
  });

  it('nome repetido vira duplicate', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ n: '0' }] })
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(
      saveSponsor({ tenantId: TENANT, id: null, expectedVersion: null, sponsor, actor: 'a' }),
    ).rejects.toBeInstanceOf(SponsorError);
  });

  it('versão velha vira stale; id de outro cliente, not_found', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rows: [{}] });
    await expect(
      archiveSponsor({ tenantId: TENANT, id: 'x', expectedVersion: 1, actor: 'a' }),
    ).rejects.toMatchObject({
      code: 'stale',
    });
    query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rows: [] });
    await expect(
      archiveSponsor({ tenantId: TENANT, id: 'x', expectedVersion: 1, actor: 'a' }),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
