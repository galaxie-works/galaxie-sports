import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getChannelList, saveChannelList, tenant, type Database } from '@galaxie/db';
import {
  fixtureChannels,
  loadWtwConfig,
  proposeChannelMatches,
  rightKey,
  type ChannelMatchOutput,
} from '@galaxie/where-to-watch';
import { FakeLlmClient } from '../src/llm/fake.js';
import { runChannelLists } from '../src/channels/run.js';
import { disposableDb } from './helpers.js';

/*
 * Job `channel-lists` contra o banco, com o provedor falso: teto de pedidos por lista e rodada (o
 * resto fica para a próxima, com as decisões já feitas reaproveitadas) e um `purpose` por lote.
 */

const { setup, teardown } = disposableDb();
let db: Database;
let tenantId: string;
const config = loadWtwConfig({ env: {} });
const MARKETS = ['BR', 'AR', 'CL', 'CO', 'MX'];
/** Exemplo de referência com dois canais que só a IA poderia casar: um lote na CO e outro no MX. */
const channels = [
  ...fixtureChannels(),
  { idx: 11, name: 'DISNEY PLUS PREMIUM LIVE', group: 'COLOMBIA' },
  { idx: 12, name: 'PARAMOUNT PLUS EVENTOS', group: 'MEXICO' },
];

/** Nenhum canal para as sobras (o que o validador sempre aceita). */
const llm = new FakeLlmClient((req) => {
  const count = req.messages[0]!.content.match(/^\d+: país /gm)?.length ?? 0;
  const data: ChannelMatchOutput = {
    transmissores: Array.from({ length: count }, (_, i) => ({
      direito_idx: i,
      canal_cliente_idx: null,
      casamento: 'sem_canal_na_lista',
      nota_auditoria: null,
    })),
  };
  return { data, model: 'fake-channels' };
});

beforeAll(async () => {
  db = await setup();
  const [t] = await db
    .insert(tenant)
    .values({ slug: 'lista-teto', name: 'lista-teto', plan: 'fan_experience', modules: [] })
    .returning({ id: tenant.id });
  tenantId = t!.id;
  const { matches, aiPending, markets } = await proposeChannelMatches(config, {
    channels,
    tenantMarkets: MARKETS,
    defaultCountry: null,
    overrides: [],
  });
  expect(aiPending).toBe(true);
  await saveChannelList(db, tenantId, {
    source: 'text',
    defaultCountry: null,
    markets,
    channels,
    proposed: matches,
    overrides: [],
    aiStatus: 'pending',
  });
}, 120_000);

afterAll(teardown);

describe('runChannelLists', () => {
  it('para no teto de pedidos por lista e continua na rodada seguinte, sem repetir o que já decidiu', async () => {
    const logs: string[] = [];
    const first = await runChannelLists({ db, llm, config, maxBatches: 1, log: (m) => logs.push(m) });
    expect(first).toEqual([
      expect.objectContaining({ tenantId, outcome: 'partial', batches: 1, deferred: 1 }),
    ]);
    expect(logs.join('\n')).toMatch(/1 pedido\(s\) acima do teto de 1 ficaram para a próxima rodada/);
    let row = (await getChannelList(db, tenantId))!;
    expect(row.aiStatus).toBe('pending');
    expect(row.aiNote).toMatch(/1 pedido\(s\) para a próxima rodada/);
    const decided = row.proposed.filter((m) => m.origin === 'ia').map(rightKey);
    expect(decided).toHaveLength(1);

    const second = await runChannelLists({ db, llm, config, maxBatches: 1 });
    expect(second).toEqual([expect.objectContaining({ tenantId, outcome: 'done', batches: 1, deferred: 0 })]);
    row = (await getChannelList(db, tenantId))!;
    expect(row.aiStatus).toBe('done');
    // a decisão da primeira rodada continua, e a segunda decidiu o outro lote
    const all = row.proposed.filter((m) => m.origin === 'ia').map(rightKey);
    expect(all).toEqual(expect.arrayContaining([...decided]));
    expect(all.sort()).toEqual(['CO:disney_plus', 'MX:paramount_plus']);

    // um pedido por lote nas duas rodadas, cada um com o seu purpose
    const purposes = llm.calls.map((c) => c.purpose);
    expect(purposes).toHaveLength(2);
    expect(new Set(purposes).size).toBe(2);
    for (const p of purposes) expect(p).toMatch(new RegExp(`^channels@v1:${tenantId}:(CO|MX):1$`));
  });
});
