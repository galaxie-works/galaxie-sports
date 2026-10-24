/**
 * Permissões e efeitos das ações do portal "Minha lista de canais": o tenant vem da sessão (com os
 * mercados dele), entradas inválidas não chegam ao banco e só nomes de canais são enviados.
 */
import { ChannelListError } from '@galaxie/where-to-watch/channel-list';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readClientContext = vi.fn();
const uploadChannelList = vi.fn();
const reprocessChannelList = vi.fn();
const overrideChannels = vi.fn();
const confirmChannelList = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/client/session', () => ({ readClientContext: () => readClientContext() }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));
vi.mock('@/lib/channel-list/server', () => ({
  isWtwCountry: (c: unknown) =>
    typeof c === 'string' && ['BR', 'AR', 'CL', 'CO', 'MX', 'PE', 'UY', 'EC'].includes(c),
  uploadChannelList: (...a: unknown[]) => uploadChannelList(...a),
  reprocessChannelList: (...a: unknown[]) => reprocessChannelList(...a),
  overrideChannels: (...a: unknown[]) => overrideChannels(...a),
}));
vi.mock('@/lib/channel-list/store', () => ({
  channelListDb: () => ({}),
  confirmChannelList: (...a: unknown[]) => confirmChannelList(...a),
}));

const { confirmChannels, correctChannels, reprocessChannels, uploadChannels } = await import('./actions');

const TENANT = {
  id: '01a16029-0000-7000-8000-000000000001',
  name: 'Operadora Exemplo',
  markets: ['BR', 'CL'],
};
const ctx = (over: Record<string, unknown> = {}) => ({
  userId: 'u-cliente',
  email: 'cliente.exemplo@galaxie.test',
  role: 'client',
  tenant: TENANT,
  tenants: [],
  ...over,
});

beforeEach(() => {
  for (const fn of [
    readClientContext,
    uploadChannelList,
    reprocessChannelList,
    overrideChannels,
    confirmChannelList,
  ])
    fn.mockReset();
  readClientContext.mockResolvedValue(ctx());
  uploadChannelList.mockResolvedValue({ row: {}, duplicates: 1, truncated: 0 });
  reprocessChannelList.mockResolvedValue({});
  overrideChannels.mockResolvedValue({});
  confirmChannelList.mockResolvedValue({});
});

describe('envio da lista', () => {
  it('grava no tenant e usuário da sessão, com o país padrão', async () => {
    const res = await uploadChannels({ content: 'GLOBO SP\nESPN HD', defaultCountry: 'BR' });
    expect(res).toEqual({ ok: true, duplicates: 1, truncated: 0 });
    expect(uploadChannelList).toHaveBeenCalledWith(TENANT, 'u-cliente', {
      content: 'GLOBO SP\nESPN HD',
      defaultCountry: 'BR',
    });
  });

  it('recusa lista vazia, país fora do onde assistir e lista sem nomes', async () => {
    expect((await uploadChannels({ content: '  ' })).ok).toBe(false);
    expect((await uploadChannels({ content: 'GLOBO', defaultCountry: 'US' })).error).toMatch(/País/);
    uploadChannelList.mockRejectedValueOnce(new ChannelListError('x', 'no_channels'));
    expect(await uploadChannels({ content: '#EXTM3U' })).toEqual({
      ok: false,
      error: 'Nenhum nome de canal na lista.',
    });
  });

  it('sem sessão ou sem tenant, nada é gravado', async () => {
    readClientContext.mockResolvedValueOnce(null);
    expect((await uploadChannels({ content: 'GLOBO' })).ok).toBe(false);
    readClientContext.mockResolvedValueOnce(ctx({ tenant: null }));
    expect((await confirmChannels()).ok).toBe(false);
    expect(uploadChannelList).not.toHaveBeenCalled();
    expect(confirmChannelList).not.toHaveBeenCalled();
  });
});

describe('correção, reprocessamento e confirmação', () => {
  it('corrige só emissora de país válido, com índices limpos', async () => {
    expect(
      await correctChannels({ country: 'CL', broadcasterId: 'chilevision', channels: [4, 4, -1, 2.5] }),
    ).toEqual({
      ok: true,
    });
    expect(overrideChannels).toHaveBeenCalledWith(TENANT, {
      country: 'CL',
      broadcasterId: 'chilevision',
      channels: [4],
    });
    await correctChannels({ country: 'CL', broadcasterId: 'chilevision', channels: null });
    expect(overrideChannels).toHaveBeenLastCalledWith(TENANT, {
      country: 'CL',
      broadcasterId: 'chilevision',
      channels: null,
    });
    expect((await correctChannels({ country: 'XX', broadcasterId: 'a', channels: [] })).ok).toBe(false);
    overrideChannels.mockResolvedValueOnce(null);
    expect((await correctChannels({ country: 'BR', broadcasterId: 'fora', channels: [] })).ok).toBe(false);
  });

  it('reprocessa e confirma a lista do tenant da sessão', async () => {
    expect(await reprocessChannels()).toEqual({ ok: true });
    expect(reprocessChannelList).toHaveBeenCalledWith(TENANT, 'u-cliente');
    expect(await confirmChannels()).toEqual({ ok: true });
    expect(confirmChannelList).toHaveBeenCalledWith({}, TENANT.id, 'u-cliente');
    confirmChannelList.mockResolvedValueOnce(null);
    expect((await confirmChannels()).error).toMatch(/Envie a lista/);
  });
});
