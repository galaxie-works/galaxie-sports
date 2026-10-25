/**
 * Lista de canais do cliente no banco: o job da IA não sobrescreve a correção feita enquanto o
 * modelo pensava (`revision`), e a fila do job não trava atrás das listas que sempre falham.
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  getChannelList,
  runMigrations,
  saveChannelList,
  saveChannelListAi,
  setChannelListOverrides,
  tenant,
  type Database,
  type StoredChannelMatch,
} from '../src/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;

const match = (over: Partial<StoredChannelMatch> = {}): StoredChannelMatch => ({
  country: 'BR',
  broadcasterId: 'canal-exemplo',
  name: 'Canal Exemplo',
  access: 'linear',
  match: 'sem_canal_na_lista',
  channels: [],
  origin: 'codigo',
  note: null,
  ...over,
});

async function newTenant(slug: string): Promise<string> {
  const [t] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'fan_experience', modules: [] })
    .returning({ id: tenant.id });
  return t!.id;
}

const upload = (tenantId: string, now?: Date) =>
  saveChannelList(db, tenantId, {
    source: 'text',
    defaultCountry: 'BR',
    markets: ['BR'],
    channels: [
      { idx: 0, name: 'CANAL EXEMPLO HD', group: null },
      { idx: 1, name: 'OUTRO CANAL', group: null },
    ],
    proposed: [match()],
    overrides: [],
    aiStatus: 'pending',
    ...(now ? { now } : {}),
  });

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
}, 120_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('saveChannelListAi × correção do cliente', () => {
  it('correção feita enquanto a IA pensava não é sobrescrita; a lista continua pendente', async () => {
    const id = await newTenant('lista-correcao-no-meio');
    await upload(id);
    // o job lê a lista...
    const read = (await getChannelList(db, id))!;
    expect(read.revision).toBe(0);
    // ...o cliente corrige no portal enquanto o modelo pensa...
    const fixed = match({ channels: [0], match: 'exato', origin: 'cliente', note: 'Corrigido pelo cliente.' });
    const corrected = await setChannelListOverrides(db, id, {
      overrides: [{ country: 'BR', broadcasterId: 'canal-exemplo', channelKeys: ['canal exemplo'] }],
      proposed: [fixed],
    });
    expect(corrected!.revision).toBe(1);
    // ...e o resultado da IA, calculado sem a correção, chega depois: não grava
    const saved = await saveChannelListAi(db, id, {
      processedAt: read.processedAt,
      revision: read.revision,
      proposed: [match({ channels: [1], match: 'nome_divergente', origin: 'ia', note: 'IA.' })],
      aiStatus: 'done',
      aiNote: null,
    });
    expect(saved).toBe(false);
    const after = (await getChannelList(db, id))!;
    expect(after.proposed).toEqual([fixed]);
    // a IA não conferiu a lista corrigida: o próximo job pega de novo
    expect(after.aiStatus).toBe('pending');

    // com a revisão atual, grava
    expect(
      await saveChannelListAi(db, id, {
        processedAt: after.processedAt,
        revision: after.revision,
        proposed: [fixed],
        aiStatus: 'done',
        aiNote: null,
      }),
    ).toBe(true);
    expect((await getChannelList(db, id))!.aiStatus).toBe('done');
  });

});
