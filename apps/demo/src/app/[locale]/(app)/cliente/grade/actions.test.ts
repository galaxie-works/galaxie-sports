/**
 * Permissões e efeitos das ações do portal "Grade e ofertas": o tenant vem da sessão, a operadora só pede
 * revisão da própria grade publicada (ou a inclusão num plano dela) e só mexe na preferência do tenant.
 */
import { LineupError } from '@galaxie/db/lineups';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readClientContext = vi.fn();
const findOperatorTarget = vi.fn();
const createLineupReviewRequest = vi.fn();
const getTenantOperator = vi.fn();
const setTenantOperator = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/client/session', () => ({ readClientContext: () => readClientContext() }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));
vi.mock('@/lib/lineup/server', () => ({
  findOperatorTarget: (...a: unknown[]) => findOperatorTarget(...a),
}));
vi.mock('@/lib/lineup/store', async () => ({
  LineupError: (await import('@galaxie/db/lineups')).LineupError,
  lineupDb: () => ({}),
  createLineupReviewRequest: (...a: unknown[]) => createLineupReviewRequest(...a),
  getTenantOperator: (...a: unknown[]) => getTenantOperator(...a),
  setTenantOperator: (...a: unknown[]) => setTenantOperator(...a),
}));

const { requestLineupReview, setShowOtherOperators } = await import('./actions');

const TENANT = '01a16029-0000-7000-8000-000000000001';
const PLATFORM = '01a20000-0000-7000-8000-000000000001';
const PLAN = '01a20000-0000-7000-8000-000000000011';
const ctx = (over: Record<string, unknown> = {}) => ({
  userId: 'u-cliente',
  email: 'cliente.exemplo@galaxie.test',
  role: 'client',
  tenant: { id: TENANT, name: 'Operadora Exemplo' },
  tenants: [],
  ...over,
});
const planItem = {
  type: 'plan',
  id: PLAN,
  name: 'Plano Essencial',
  fields: { name: 'Plano Essencial', priceText: 'R$ 89,90', url: null },
};

beforeEach(() => {
  for (const fn of [
    readClientContext,
    findOperatorTarget,
    createLineupReviewRequest,
    getTenantOperator,
    setTenantOperator,
  ])
    fn.mockReset();
  readClientContext.mockResolvedValue(ctx());
  findOperatorTarget.mockResolvedValue({ item: planItem, adding: false });
  createLineupReviewRequest.mockResolvedValue({ id: 'r1' });
  getTenantOperator.mockResolvedValue({
    tenantId: TENANT,
    platformId: PLATFORM,
    showOtherOperators: false,
    emailDomains: ['operadora.example'],
  });
  setTenantOperator.mockResolvedValue({});
});

describe('solicitar revisão', () => {
  it('grava o pedido no tenant e usuário da sessão, com a correção limpa e o alvo do banco', async () => {
    const res = await requestLineupReview({
      targetType: 'plan',
      targetId: PLAN,
      message: '  O preço mudou  ',
      proposed: { priceText: 'R$ 99,90', name: 'Plano Essencial', id: 'x' },
    });
    expect(res).toEqual({ ok: true });
    expect(findOperatorTarget).toHaveBeenCalledWith(TENANT, 'plan', PLAN);
    expect(createLineupReviewRequest).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      userId: 'u-cliente',
      target: { type: 'plan', id: PLAN },
      message: 'O preço mudou',
      proposed: { priceText: 'R$ 99,90' },
    });
  });

  it('inclusão de canal num plano: vínculo `<plano>:<canal>` com o acesso', async () => {
    findOperatorTarget.mockResolvedValue({ item: null, adding: true });
    const res = await requestLineupReview({
      targetType: 'plan_channel',
      targetId: `${PLAN}:canal-exemplo`,
      message: 'Falta este canal',
      proposed: { access: 'addon' },
    });
    expect(res).toEqual({ ok: true });
    expect(createLineupReviewRequest.mock.calls[0]![1]).toMatchObject({
      target: { type: 'plan_channel', planId: PLAN, channelId: 'canal-exemplo' },
      proposed: { access: 'addon' },
    });
  });

  it('item fora da grade publicada da operadora: não encontrado, sem gravar', async () => {
    findOperatorTarget.mockResolvedValue(null);
    const res = await requestLineupReview({ targetType: 'plan', targetId: PLAN, message: 'x' });
    expect(res).toMatchObject({ ok: false, error: 'Item não encontrado na grade da sua operadora.' });
    expect(createLineupReviewRequest).not.toHaveBeenCalled();
  });

  it('id ou tipo fora do formato nem consulta a grade', async () => {
    for (const input of [
      { targetType: 'plan' as const, targetId: 'nao-e-uuid' },
      { targetType: 'plan_channel' as const, targetId: PLAN },
      { targetType: 'canal' as never, targetId: PLAN },
    ])
      expect((await requestLineupReview({ ...input, message: 'x' })).ok).toBe(false);
    expect(findOperatorTarget).not.toHaveBeenCalled();
  });

  it('o banco recusa item de outra plataforma (forbidden_target): não encontrado', async () => {
    createLineupReviewRequest.mockRejectedValue(new LineupError('forbidden_target', 'x'));
    expect(await requestLineupReview({ targetType: 'plan', targetId: PLAN, message: 'x' })).toMatchObject({
      ok: false,
      error: 'Item não encontrado na grade da sua operadora.',
    });
  });

  it('exige mensagem', async () => {
    expect(await requestLineupReview({ targetType: 'plan', targetId: PLAN, message: '   ' })).toMatchObject({
      ok: false,
      error: 'Conte o que está errado.',
    });
  });

  it('sem sessão do painel ou sem tenant: nega', async () => {
    const input = { targetType: 'plan' as const, targetId: PLAN, message: 'x' };
    readClientContext.mockResolvedValueOnce(null);
    expect(await requestLineupReview(input)).toMatchObject({ ok: false, error: 'Sem acesso a esta ação.' });
    readClientContext.mockResolvedValueOnce(ctx({ tenant: null }));
    expect((await requestLineupReview(input)).ok).toBe(false);
    expect(createLineupReviewRequest).not.toHaveBeenCalled();
  });
});

describe('mostrar outras operadoras', () => {
  it('muda só a preferência do tenant da sessão', async () => {
    expect(await setShowOtherOperators(true)).toEqual({ ok: true });
    expect(setTenantOperator).toHaveBeenCalledWith(expect.anything(), TENANT, { showOtherOperators: true });
  });

  it('tenant sem operadora ligada ou sem sessão: nega', async () => {
    getTenantOperator.mockResolvedValueOnce({
      tenantId: TENANT,
      platformId: null,
      showOtherOperators: false,
      emailDomains: [],
    });
    expect((await setShowOtherOperators(true)).ok).toBe(false);
    readClientContext.mockResolvedValueOnce(null);
    expect((await setShowOtherOperators(true)).ok).toBe(false);
    expect(setTenantOperator).not.toHaveBeenCalled();
  });
});
