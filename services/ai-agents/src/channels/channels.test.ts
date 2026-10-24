/**
 * O casamento da lista de canais com a IA nas sobras: o pedido só leva direitos e canais numerados,
 * o schema é estrito (índices em enum) e o validador recusa o que fere as regras.
 */
import { describe, expect, it } from 'vitest';
import {
  ChannelDictionary,
  FIXTURE_EXPECTED,
  fixtureChannels,
  fixtureRights,
  loadWtwConfig,
  processChannelList,
  rightKey,
  type ChannelMatchOutput,
} from '@galaxie/where-to-watch';
import { FakeLlmClient } from '../llm/fake.js';
import { strictSchemaProblems } from '../llm/json-schema.js';
import { channelMatcher } from './run.js';

const config = loadWtwConfig({ env: {} });
const dict = new ChannelDictionary(config);
/** Lista do exemplo com dois canais a mais, que só a IA (nas sobras) poderia casar. */
const channels = [...fixtureChannels(), { idx: 11, name: 'DISNEY PLUS PREMIUM LIVE', group: 'COLOMBIA' }];

describe('IA nas sobras da lista de canais', () => {
  it('pedido com índices em enum, schema estrito e resultado do exemplo de referência', async () => {
    const llm = new FakeLlmClient((req) => {
      // direitos numerados da mensagem: `0: país "CO" | plataforma_id "disney_plus" | acesso "..."`
      const rights = [
        ...req.messages[0]!.content.matchAll(/^(\d+): país "\w+" \| plataforma_id "([^"]+)"/gm),
      ];
      const data: ChannelMatchOutput = {
        transmissores: rights.map(([, idx, id]) => ({
          direito_idx: Number(idx),
          // a IA tenta casar o streaming com o canal linear como exato: o validador recusa
          canal_cliente_idx: id === 'disney_plus' ? 11 : null,
          casamento: id === 'disney_plus' ? 'exato' : 'sem_canal_na_lista',
          nota_auditoria: null,
        })),
      };
      return { data };
    });
    const res = await processChannelList(
      { channels, rights: fixtureRights(config), dict },
      channelMatcher(llm, 'tenant-teste'),
    );
    expect(llm.calls.length).toBe(res.batches.length);
    for (const call of llm.calls) {
      expect(strictSchemaProblems(call.schema)).toEqual([]);
      expect(call.messages[0]!.content).not.toMatch(/VOD/); // VOD fica fora antes da IA
      expect(call.purpose).toMatch(/^channels@v1:tenant-teste:/);
    }
    const by = new Map(res.matches.map((m) => [rightKey(m), m]));
    for (const [key, exp] of Object.entries(FIXTURE_EXPECTED)) expect(by.get(key)?.match).toBe(exp.match);
    expect(by.get('CO:disney_plus')).toMatchObject({ match: 'sem_canal_na_lista', origin: 'ia' });
    expect(res.violations.join('\n')).toMatch(/streaming/);
  });

  it('saída fora do schema (texto livre no lugar do índice) é recusada pelo cliente', async () => {
    const llm = new FakeLlmClient(() => ({
      data: {
        transmissores: [
          { direito_idx: 0, canal_cliente_idx: 'Paramount并发', casamento: 'exato', nota_auditoria: null },
        ],
      },
    }));
    await expect(
      processChannelList({ channels, rights: fixtureRights(config), dict }, channelMatcher(llm, 't')),
    ).rejects.toThrow(/fora do schema/);
  });
});
