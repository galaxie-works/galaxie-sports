/**
 * Correção do cliente no portal: desfazer a correção de uma emissora que só a IA casaria devolve a
 * lista para o job da IA (`pending`); corrigir outra emissora mantém as decisões da IA e o status.
 */
import {
  ChannelDictionary,
  clientChannelKey,
  fixtureChannels,
  processChannelList,
  universeRights,
  type AiBatch,
  type ChannelOverride,
} from '@galaxie/where-to-watch/channel-list';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getChannelList = vi.fn();
const setChannelListOverrides = vi.fn();
vi.mock('./store', () => ({
  channelListDb: () => ({}),
  getChannelList: (...a: unknown[]) => getChannelList(...a),
  saveChannelList: vi.fn(),
  setChannelListOverrides: (...a: unknown[]) => setChannelListOverrides(...a),
}));

const { overrideChannels, wtwConfig } = await import('./server');

const TENANT = { id: '01a16029-0000-7000-8000-000000000001', markets: ['BR', 'AR', 'CL', 'CO', 'MX'] };
/** Exemplo de referência com um canal que só a IA (nas sobras) poderia casar com o Disney+ da Colômbia. */
const channels = [...fixtureChannels(), { idx: 11, name: 'DISNEY PLUS PREMIUM LIVE', group: 'COLOMBIA' }];
const DISNEY: ChannelOverride = { country: 'CO', broadcasterId: 'disney_plus', channelKeys: [] };

/** Lista como o job da IA a deixou: a IA respondeu sem canal em todas as sobras. */
async function aiDone(overrides: ChannelOverride[]) {
  const config = wtwConfig();
  const res = await processChannelList(
    {
      channels,
      rights: universeRights(config, TENANT.markets),
      dict: new ChannelDictionary(config),
      overrides,
    },
    async (batch: AiBatch) => ({
      transmissores: batch.rights.map((_, i) => ({
        direito_idx: i,
        canal_cliente_idx: null,
        casamento: 'sem_canal_na_lista',
        nota_auditoria: null,
      })),
    }),
  );
  return {
    tenantId: TENANT.id,
    channels,
    defaultCountry: null,
    overrides,
    proposed: res.matches,
    aiStatus: 'done',
  };
}

beforeEach(() => {
  getChannelList.mockReset();
  setChannelListOverrides.mockReset();
  setChannelListOverrides.mockResolvedValue({});
});

describe('overrideChannels', () => {
  it('desfazer a correção que gera uma sobra nova volta a IA para pending', async () => {
    getChannelList.mockResolvedValue(await aiDone([DISNEY]));
    await overrideChannels(TENANT, { country: 'CO', broadcasterId: 'disney_plus', channels: null });
    const [, , input] = setChannelListOverrides.mock.calls[0]!;
    expect(input.overrides).toEqual([]);
    expect(input.aiStatus).toBe('pending');
  });

  it('corrigir outra emissora mantém as decisões da IA e não reabre o job', async () => {
    getChannelList.mockResolvedValue(await aiDone([]));
    const globo = channels.findIndex((c) => clientChannelKey(c.name).includes('globo'));
    await overrideChannels(TENANT, { country: 'BR', broadcasterId: 'globo', channels: [globo] });
    const [, , input] = setChannelListOverrides.mock.calls[0]!;
    expect(input.overrides).toEqual([
      { country: 'BR', broadcasterId: 'globo', channelKeys: [clientChannelKey(channels[globo]!.name)] },
    ]);
    expect(input).not.toHaveProperty('aiStatus');
    expect(
      input.proposed.find(
        (m: { country: string; broadcasterId: string }) =>
          m.country === 'CO' && m.broadcasterId === 'disney_plus',
      ),
    ).toMatchObject({ origin: 'ia' });
  });
});
