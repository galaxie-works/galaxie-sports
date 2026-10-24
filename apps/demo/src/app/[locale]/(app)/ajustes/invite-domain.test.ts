/**
 * Convite de usuário cliente com e-mail fora dos domínios da operadora do tenant: aviso, não bloqueio. Sem
 * a confirmação do admin o convite volta com o aviso; com ela, segue (agência, consultor).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createUser = vi.fn();
let domains: string[] = [];
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: async () => ({ id: 'u-admin', email: 'a@galaxie.test' }),
}));
vi.mock('@/lib/auth/db', () => ({ pool: {} }));
vi.mock('@/lib/auth/invite', () => ({ sendInvite: async () => ({ emailSent: true, link: null }) }));
vi.mock('@/lib/auth/server', () => ({ auth: { api: { createUser: (a: unknown) => createUser(a) } } }));
vi.mock('@/lib/client/tenants', () => ({ tenantExists: async () => true }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));
vi.mock('@/lib/lineup/store', () => ({
  lineupDb: () => ({}),
  getTenantOperator: async (_db: unknown, tenantId: string) => ({
    tenantId,
    platformId: null,
    showOtherOperators: false,
    emailDomains: domains,
    platform: null,
  }),
}));

const { inviteUser } = await import('./actions');

const TENANT = '01a16029-0000-7000-8000-000000000001';
const invite = (email: string, confirmOutsideDomain?: boolean) =>
  inviteUser({
    name: 'Pessoa',
    email,
    role: 'client',
    tenantId: TENANT,
    accessDays: 14,
    locale: 'pt-BR',
    ...(confirmOutsideDomain === undefined ? {} : { confirmOutsideDomain }),
  });

beforeEach(() => {
  domains = ['operadora.example'];
  createUser.mockReset();
  createUser.mockResolvedValue({ user: { id: 'u-novo' } });
});

describe('convite de cliente e domínios da operadora', () => {
  it('e-mail da operadora (ou subdomínio) segue direto', async () => {
    expect(await invite('ana@operadora.example')).toMatchObject({ ok: true });
    expect(await invite('bia@tv.operadora.example')).toMatchObject({ ok: true });
    expect(createUser).toHaveBeenCalledTimes(2);
  });

  it('fora dos domínios: volta com o aviso; confirmado, convida', async () => {
    const warned = await invite('ana@agencia.example');
    expect(warned).toMatchObject({ ok: false, outsideDomain: true });
    expect(createUser).not.toHaveBeenCalled();
    expect(await invite('ana@agencia.example', true)).toMatchObject({ ok: true });
    expect(createUser).toHaveBeenCalledTimes(1);
  });

  it('tenant sem domínios cadastrados não avisa', async () => {
    domains = [];
    expect(await invite('ana@agencia.example')).toMatchObject({ ok: true });
  });
});
