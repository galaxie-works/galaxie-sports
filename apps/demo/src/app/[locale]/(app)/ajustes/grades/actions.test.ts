/**
 * Permissões e efeitos das ações de Ajustes → Grades e ofertas: só admin, e cada decisão grava quem fez.
 */
import { LineupError } from '@galaxie/db/lineups';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdmin = vi.fn();
const setLineupReviewStatus = vi.fn();
const dismissLineupChange = vi.fn();
const resolveLineupReviewRequest = vi.fn();
const setTenantOperator = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('@/lib/client/tenants', () => ({ tenantExists: async (id: string) => id === TENANT }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));
vi.mock('@/lib/lineup/store', async () => ({
  LineupError: (await import('@galaxie/db/lineups')).LineupError,
  lineupDb: () => ({}),
  setLineupReviewStatus: (...a: unknown[]) => setLineupReviewStatus(...a),
  dismissLineupChange: (...a: unknown[]) => dismissLineupChange(...a),
  resolveLineupReviewRequest: (...a: unknown[]) => resolveLineupReviewRequest(...a),
  setTenantOperator: (...a: unknown[]) => setTenantOperator(...a),
}));

const { decideLineupItem, dismissLineupItemChange, resolveLineupRequest, saveTenantOperator } =
  await import('./actions');

const TENANT = '01a16029-0000-7000-8000-000000000001';
const PLATFORM = '01a20000-0000-7000-8000-000000000001';
const PLAN = '01a20000-0000-7000-8000-000000000011';
const REQUEST = '01a20000-0000-7000-8000-000000000099';
const ADMIN = { id: 'u-admin', email: 'teste.admin@galaxie.test' };
/** O `redirect` do Next interrompe a ação lançando; aqui basta o erro. */
const redirected = () => {
  throw new Error('NEXT_REDIRECT');
};
const mocks = [
  requireAdmin,
  setLineupReviewStatus,
  dismissLineupChange,
  resolveLineupReviewRequest,
  setTenantOperator,
];

beforeEach(() => {
  mocks.forEach((m) => m.mockReset());
  requireAdmin.mockResolvedValue(ADMIN);
  setLineupReviewStatus.mockResolvedValue(true);
  dismissLineupChange.mockResolvedValue(true);
  resolveLineupReviewRequest.mockResolvedValue({ id: REQUEST });
  setTenantOperator.mockResolvedValue({ tenantId: TENANT });
});

describe('só admin', () => {
  it('cliente ou convidado não decide, não descarta, não resolve e não liga tenant', async () => {
    requireAdmin.mockImplementation(redirected);
    await expect(decideLineupItem({ type: 'platform', id: PLATFORM }, 'rejected')).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    await expect(dismissLineupItemChange({ type: 'plan', id: PLAN })).rejects.toThrow('NEXT_REDIRECT');
    await expect(resolveLineupRequest(REQUEST, { status: 'accepted' })).rejects.toThrow('NEXT_REDIRECT');
    await expect(
      saveTenantOperator(TENANT, { platformId: PLATFORM, domains: '', showOtherOperators: true }),
    ).rejects.toThrow('NEXT_REDIRECT');
    for (const m of mocks.slice(1)) expect(m).not.toHaveBeenCalled();
  });
});

describe('revisão dos itens', () => {
  it('decide com o alvo do banco e o e-mail do admin', async () => {
    expect(await decideLineupItem({ type: 'plan_channel', id: `${PLAN}:canal-exemplo` }, 'approved')).toEqual(
      {
        ok: true,
      },
    );
    expect(setLineupReviewStatus).toHaveBeenCalledWith(
      expect.anything(),
      { type: 'plan_channel', planId: PLAN, channelId: 'canal-exemplo' },
      'approved',
      ADMIN.email,
    );
    for (const status of ['reviewed', 'draft', 'rejected'] as const)
      expect(await decideLineupItem({ type: 'platform', id: PLATFORM }, status)).toEqual({ ok: true });
  });

  it('descarta a mudança encontrada', async () => {
    expect(await dismissLineupItemChange({ type: 'plan', id: PLAN })).toEqual({ ok: true });
    expect(dismissLineupChange).toHaveBeenCalledWith(
      expect.anything(),
      { type: 'plan', id: PLAN },
      ADMIN.email,
    );
  });

  it('item, tipo ou status inválidos nem chegam ao banco; item inexistente avisa', async () => {
    expect((await decideLineupItem({ type: 'plan', id: `${PLAN}:x` }, 'approved')).ok).toBe(false);
    expect((await decideLineupItem({ type: 'platform', id: PLATFORM }, 'publicado' as never)).ok).toBe(false);
    expect((await decideLineupItem({ type: 'canal' as never, id: PLATFORM }, 'approved')).ok).toBe(false);
    expect(setLineupReviewStatus).not.toHaveBeenCalled();
    setLineupReviewStatus.mockResolvedValue(false);
    expect(await decideLineupItem({ type: 'platform', id: PLATFORM }, 'approved')).toMatchObject({
      ok: false,
    });
  });
});

describe('pedidos das operadoras', () => {
  it('aceitar e aplicar passa `apply` e quem resolveu', async () => {
    expect(await resolveLineupRequest(REQUEST, { status: 'accepted', apply: true, note: ' ok ' })).toEqual({
      ok: true,
    });
    expect(resolveLineupReviewRequest).toHaveBeenCalledWith(expect.anything(), REQUEST, {
      status: 'accepted',
      note: 'ok',
      by: ADMIN.email,
      apply: true,
    });
  });

  it('recusar exige nota e nunca aplica', async () => {
    expect(await resolveLineupRequest(REQUEST, { status: 'rejected', note: '  ' })).toMatchObject({
      ok: false,
      error: 'Escreva uma nota para recusar.',
    });
    expect(resolveLineupReviewRequest).not.toHaveBeenCalled();
    await resolveLineupRequest(REQUEST, { status: 'rejected', note: 'Conferido na fonte', apply: true });
    expect(resolveLineupReviewRequest.mock.calls[0]![2]).toMatchObject({ status: 'rejected', apply: false });
  });

  it('pedido já resolvido ou inexistente: avisa', async () => {
    resolveLineupReviewRequest.mockRejectedValue(new LineupError('already_resolved', 'x'));
    expect(await resolveLineupRequest(REQUEST, { status: 'accepted' })).toMatchObject({
      ok: false,
      error: 'Pedido não encontrado ou já resolvido.',
    });
    expect((await resolveLineupRequest('x', { status: 'accepted' })).ok).toBe(false);
  });
});

describe('operadora do tenant', () => {
  it('liga o tenant, normaliza os domínios e guarda a preferência', async () => {
    expect(
      await saveTenantOperator(TENANT, {
        platformId: PLATFORM,
        domains: '@Operadora.example, tv.operadora.example',
        showOtherOperators: false,
      }),
    ).toEqual({ ok: true });
    expect(setTenantOperator).toHaveBeenCalledWith(expect.anything(), TENANT, {
      platformId: PLATFORM,
      emailDomains: ['operadora.example', 'tv.operadora.example'],
      showOtherOperators: false,
    });
  });

  it('recusa tenant inexistente, operadora inexistente e domínio inválido', async () => {
    const other = '01a16029-0000-7000-8000-000000000009';
    expect(
      (await saveTenantOperator(other, { platformId: PLATFORM, domains: '', showOtherOperators: false })).ok,
    ).toBe(false);
    const bad = await saveTenantOperator(TENANT, {
      platformId: PLATFORM,
      domains: 'nada',
      showOtherOperators: false,
    });
    expect(bad.error).toContain('nada');
    expect(setTenantOperator).not.toHaveBeenCalled();
    setTenantOperator.mockRejectedValue(new LineupError('target_not_found', 'x'));
    expect(
      await saveTenantOperator(TENANT, { platformId: PLATFORM, domains: '', showOtherOperators: false }),
    ).toMatchObject({ ok: false, error: 'Operadora não encontrada.' });
  });
});
