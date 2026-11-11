/**
 * Configuração das permissões por cargo no servidor: linhas do banco viram configuração limpa (nada a mais passa),
 * o cache curto evita ler o banco a cada página e a gravação o limpa.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/auth/db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

const { loadRoleOverrides, invalidateRoleOverrides, overridesFromRows, rowsFromOverrides, TTL_MS } =
  await import('./role-permissions');

const TENANT = '01a16029-0000-7000-8000-000000000001';

beforeEach(() => {
  query.mockReset();
  invalidateRoleOverrides(TENANT);
});

describe('linhas do banco → configuração', () => {
  it('guarda só o que difere do padrão e descarta Dono, ação fixa, piso e lixo', () => {
    expect(
      overridesFromRows([
        { role: 'admin', action: 'cosmos.manage', allowed: true },
        { role: 'admin', action: 'cosmos.view', allowed: true }, // igual ao padrão
        { role: 'owner', action: 'cosmos.view', allowed: false }, // Dono não se tranca fora
        { role: 'admin', action: 'legal.export', allowed: true }, // fixa
        { role: 'volunteer', action: 'cosmos.view', allowed: true }, // abaixo do piso
        { role: 'chefe', action: 'cosmos.view', allowed: true },
        { role: 'admin', action: 'cosmos.tudo', allowed: true },
      ]),
    ).toEqual({ admin: { 'cosmos.manage': true } });
  });

  it('ida e volta: configuração → linhas → configuração', () => {
    const cfg = { admin: { 'cosmos.manage': true }, moderator: { 'moderation.hide': false } } as const;
    const rows = rowsFromOverrides(overridesFromRows(rowsFromOverrides(cfg)));
    expect(overridesFromRows(rows)).toEqual(overridesFromRows(rowsFromOverrides(cfg)));
  });
});

describe('leitura com cache curto', () => {
  it('sem linha no banco = null (matriz padrão)', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await loadRoleOverrides(TENANT)).toBeNull();
  });

  it('lê uma vez dentro do prazo; depois do prazo, de novo; gravar limpa o cache', async () => {
    query.mockResolvedValue({ rows: [{ role: 'admin', action: 'cosmos.manage', allowed: true }] });
    const now = 1_000_000;
    expect(await loadRoleOverrides(TENANT, { now })).toEqual({ admin: { 'cosmos.manage': true } });
    await loadRoleOverrides(TENANT, { now: now + TTL_MS - 1 });
    expect(query).toHaveBeenCalledTimes(1);
    await loadRoleOverrides(TENANT, { now: now + TTL_MS });
    expect(query).toHaveBeenCalledTimes(2);
    invalidateRoleOverrides(TENANT);
    await loadRoleOverrides(TENANT, { now: now + TTL_MS + 1 });
    expect(query).toHaveBeenCalledTimes(3);
    await loadRoleOverrides(TENANT, { now: now + TTL_MS + 2, fresh: true });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('banco sem a tabela (migration atrasada): matriz padrão; outro erro sobe', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '42P01' }));
    expect(await loadRoleOverrides(TENANT)).toBeNull();
    query.mockRejectedValueOnce(new Error('caiu'));
    await expect(loadRoleOverrides(TENANT, { fresh: true })).rejects.toThrow('caiu');
  });

  it('tenant que não é uuid nem chega ao banco', async () => {
    expect(await loadRoleOverrides("1' or 1=1")).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
