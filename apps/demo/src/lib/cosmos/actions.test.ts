/**
 * Recusa por cargo (#1019) nas ações da Cosmos AI: ver pede `cosmos.view`; comprar, recarga automática, ligar e
 * desligar pedem `cosmos.manage`. A recusa volta como texto traduzido e nada chega ao banco nem ao Stripe.
 */
import type { TenantRole } from '@galaxie/engage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readClientContext = vi.fn();
const cosmos = {
  listPackages: vi.fn(),
  getAutoRecharge: vi.fn(),
  createPurchaseIntent: vi.fn(),
  createCheckoutSession: vi.fn(),
  attachCheckoutSession: vi.fn(),
  getPurchaseIntent: vi.fn(),
  configureAutoRecharge: vi.fn(),
  enableCosmos: vi.fn(),
  disableCosmos: vi.fn(),
  listLedger: vi.fn(),
};
vi.mock('@/lib/client/session', () => ({ readClientContext: () => readClientContext() }));
vi.mock('@/lib/i18n/server', () => ({
  getRequestLocale: async () => 'pt-BR',
  getTimeZone: async () => 'America/Sao_Paulo',
}));
vi.mock('@/lib/builder/store', () => ({ builderDb: () => ({}) }));
vi.mock('./data', () => ({ loadStatementPage: async () => ({ entries: [], nextCursor: null }) }));
vi.mock('@galaxie/cosmos', () => ({
  ...Object.fromEntries(Object.entries(cosmos).map(([k, fn]) => [k, (...a: unknown[]) => fn(...a)])),
  isCosmosError: () => false,
  toClientWallet: (w: unknown) => w,
  ledgerCsv: () => 'csv\n',
}));

const {
  cosmosPurchaseStatus,
  disableCosmosAction,
  enableCosmosAction,
  listCosmosPackages,
  saveAutoRecharge,
  startCosmosCheckout,
} = await import('./actions');
const { olderCosmosEntries } = await import('./statement-actions');
const { GET: csv } = await import('@/app/api/cliente/cosmos/extrato/route');

const TENANT = { id: '01a16029-0000-7000-8000-000000000001', name: 'Operadora Exemplo', markets: ['BR'] };
const PACKAGE = '01a16029-0000-7000-8000-0000000000aa';
const as = (role: TenantRole) => ({
  userId: 'u-cliente',
  email: 'cliente.exemplo@galaxie.test',
  role: 'client',
  tenant: TENANT,
  tenants: [],
  memberRole: role,
  actor: { kind: 'member', tenantId: TENANT.id, role, scope: null },
});

const manageCalls = () => [
  startCosmosCheckout(PACKAGE),
  saveAutoRecharge({ enabled: true, packageId: PACKAGE, thresholdCredits: 10, accepted: true }),
  enableCosmosAction(),
  disableCosmosAction(),
];

beforeEach(() => {
  readClientContext.mockReset();
  for (const fn of Object.values(cosmos)) fn.mockReset();
  cosmos.listPackages.mockResolvedValue([]);
  cosmos.getPurchaseIntent.mockResolvedValue({ status: 'paid', credits: 100 });
  cosmos.enableCosmos.mockResolvedValue({ trialGranted: false, wallet: {} });
  cosmos.listLedger.mockResolvedValue({ entries: [], nextCursor: null });
});

describe('cosmos.manage: comprar, recarga automática, ligar e desligar', () => {
  it.each<TenantRole>(['admin', 'senior_moderator', 'moderator', 'volunteer'])(
    '%s é recusado com a mensagem do cargo, sem tocar no banco nem no Stripe',
    async (role) => {
      readClientContext.mockResolvedValue(as(role));
      for (const res of await Promise.all(manageCalls())) {
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/Seu cargo não permite comprar créditos/);
      }
      expect(cosmos.createPurchaseIntent).not.toHaveBeenCalled();
      expect(cosmos.configureAutoRecharge).not.toHaveBeenCalled();
      expect(cosmos.enableCosmos).not.toHaveBeenCalled();
      expect(cosmos.disableCosmos).not.toHaveBeenCalled();
    },
  );

  it('o Dono passa (liga, desliga e grava a recarga no tenant da sessão)', async () => {
    readClientContext.mockResolvedValue(as('owner'));
    expect((await enableCosmosAction()).ok).toBe(true);
    expect((await disableCosmosAction()).ok).toBe(true);
    expect(
      (await saveAutoRecharge({ enabled: true, packageId: PACKAGE, thresholdCredits: 10, accepted: true }))
        .ok,
    ).toBe(true);
    expect(cosmos.configureAutoRecharge).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ tenantId: TENANT.id, userId: 'u-cliente' }),
    );
  });

  it('a equipe Galaxie passa por cima', async () => {
    readClientContext.mockResolvedValue({
      ...as('owner'),
      role: 'admin',
      memberRole: null,
      actor: { kind: 'galaxie_staff' },
    });
    expect((await disableCosmosAction()).ok).toBe(true);
  });

  it('sem sessão ou sem tenant, recusa antes do cargo', async () => {
    readClientContext.mockResolvedValue(null);
    expect((await disableCosmosAction()).error).toMatch(/sessão/);
    readClientContext.mockResolvedValue({ ...as('owner'), tenant: null, actor: null });
    expect((await disableCosmosAction()).error).toMatch(/tenant/);
    expect(cosmos.disableCosmos).not.toHaveBeenCalled();
  });
});

describe('cosmos.view: pacotes, situação da compra, extrato e CSV', () => {
  it('Admin vê; Moderador e Voluntário são recusados', async () => {
    readClientContext.mockResolvedValue(as('admin'));
    expect((await listCosmosPackages()).ok).toBe(true);
    expect((await cosmosPurchaseStatus(PACKAGE)).ok).toBe(true);
    expect(await olderCosmosEntries({ kind: [], fn: [], scope: [] })).not.toBeNull();

    for (const role of ['moderator', 'volunteer'] as const) {
      readClientContext.mockResolvedValue(as(role));
      expect((await listCosmosPackages()).error).toMatch(/Seu cargo não abre a Cosmos AI/);
      expect((await cosmosPurchaseStatus(PACKAGE)).ok).toBe(false);
      expect(await olderCosmosEntries({ kind: [], fn: [], scope: [] })).toBeNull();
    }
  });

  it('CSV: 403 com o motivo para quem não vê; 200 para o Admin', async () => {
    readClientContext.mockResolvedValue(as('moderator'));
    const denied = await csv(new Request('http://demo.test/api/cliente/cosmos/extrato'));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { title: string }).title).toMatch(/Seu cargo não abre a Cosmos AI/);
    expect(cosmos.listLedger).not.toHaveBeenCalled();

    readClientContext.mockResolvedValue(as('admin'));
    const ok = await csv(new Request('http://demo.test/api/cliente/cosmos/extrato'));
    expect(ok.status).toBe(200);
    expect(cosmos.listLedger).toHaveBeenCalledWith({}, TENANT.id, expect.anything());
  });
});
