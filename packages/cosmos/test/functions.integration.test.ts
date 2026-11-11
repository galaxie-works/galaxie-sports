import { functionDef, staffAction, type Database } from '@galaxie/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  activeFunction,
  defaultModelFor,
  isCosmosError,
  listFunctionDefs,
  staffSaveFunction,
  upsertFunctionDef,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;

const expectCode = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => isCosmosError(e) && e.code === code);

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
});

afterAll(async () => {
  await temp?.close();
});

describe('provedor e modelo por função (#1088)', () => {
  it('sem escolha vale o padrão da Cosmos; com provedor e sem modelo, o leve do provedor', async () => {
    await upsertFunctionDef(db, { name: 'fn.padrao', minCredits: 0.001, permission: 'cosmos.test' });
    expect(await activeFunction(db, 'fn.padrao')).toEqual({
      minCredits: 0.001,
      provider: 'anthropic',
      model: defaultModelFor('anthropic'),
    });
    await upsertFunctionDef(db, {
      name: 'fn.padrao',
      minCredits: 0.001,
      permission: 'cosmos.test',
      provider: 'openai',
    });
    expect(await activeFunction(db, 'fn.padrao')).toMatchObject({
      provider: 'openai',
      model: defaultModelFor('openai'),
    });
  });

  it('recusa modelo sem provedor, provedor fora da lista e modelo sem preço na tabela', async () => {
    const base = { name: 'fn.ruim', minCredits: 1, permission: 'cosmos.test' };
    await expectCode(upsertFunctionDef(db, { ...base, model: 'claude-haiku-5-5' }), 'invalid_model');
    await expectCode(
      upsertFunctionDef(db, { ...base, provider: 'mistral' as unknown as 'openai' }),
      'invalid_model',
    );
    await expectCode(
      upsertFunctionDef(db, { ...base, provider: 'anthropic', model: 'modelo-inventado-9' }),
      'invalid_model',
    );
    // modelo de outro provedor: a chamada iria para o provedor errado e sempre falharia
    await expectCode(
      upsertFunctionDef(db, { ...base, provider: 'anthropic', model: defaultModelFor('openai') }),
      'invalid_model',
    );
    // prefixo de um modelo com preço não basta: modelo novo não herda o preço de outro
    await expectCode(
      upsertFunctionDef(db, {
        ...base,
        provider: 'anthropic',
        model: `${defaultModelFor('anthropic')}-turbo`,
      }),
      'invalid_model',
    );
    expect(await activeFunction(db, 'fn.ruim')).toBeNull();
    // snapshot datado do mesmo modelo vale
    await upsertFunctionDef(db, {
      ...base,
      provider: 'anthropic',
      model: `${defaultModelFor('anthropic')}-2026-10-01`,
    });
    expect((await activeFunction(db, 'fn.ruim'))?.model).toBe(`${defaultModelFor('anthropic')}-2026-10-01`);
    // e no formato da Anthropic, sem hífens na data
    await upsertFunctionDef(db, {
      ...base,
      provider: 'anthropic',
      model: `${defaultModelFor('anthropic')}-20261001`,
    });
    expect((await activeFunction(db, 'fn.ruim'))?.model).toBe(`${defaultModelFor('anthropic')}-20261001`);
  });

  it('a equipe troca o modelo com motivo; a tela da função fica como estava', async () => {
    await upsertFunctionDef(db, {
      name: 'fn.tela',
      minCredits: 1,
      permission: 'cosmos.test',
      screen: '/cliente/cosmos',
    });
    await staffSaveFunction(db, {
      name: 'fn.tela',
      minCredits: 0.5,
      permission: 'cosmos.test',
      provider: 'openai',
      model: defaultModelFor('openai'),
      active: true,
      reason: 'modelo mais barato para testar',
      userId: 'adm',
    });
    const [row] = await db.select().from(functionDef).where(eq(functionDef.name, 'fn.tela'));
    expect(row).toMatchObject({ provider: 'openai', screen: '/cliente/cosmos' });
    expect(Number(row!.minCredits)).toBe(0.5);
    const [log] = await db.select().from(staffAction).where(eq(staffAction.action, 'function'));
    expect(log).toMatchObject({ tenantId: null, reason: 'modelo mais barato para testar', userId: 'adm' });
    expect(log!.before).toMatchObject({ minCredits: 1, provider: null });
    expect(log!.after).toMatchObject({ minCredits: 0.5, provider: 'openai' });

    // "Nova função" com nome já usado não sobrescreve a existente
    await expectCode(
      staffSaveFunction(db, {
        name: 'fn.tela',
        minCredits: 9,
        permission: 'cosmos.outra',
        create: true,
        reason: 'cadastro repetido',
        userId: 'adm',
      }),
      'function_exists',
    );
    // modelo recusado: nada muda, nem o registro da equipe
    await expectCode(
      staffSaveFunction(db, {
        name: 'fn.tela',
        minCredits: 0.5,
        permission: 'cosmos.test',
        provider: 'openai',
        model: 'sem-preco-1',
        reason: 'teste de recusa',
        userId: 'adm',
      }),
      'invalid_model',
    );
    expect(await db.select().from(staffAction).where(eq(staffAction.action, 'function'))).toHaveLength(1);

    // desligada sai do assistente, mas continua no catálogo da equipe
    await staffSaveFunction(db, {
      name: 'fn.tela',
      minCredits: 0.5,
      permission: 'cosmos.test',
      provider: null,
      active: false,
      reason: 'desligar por enquanto',
      userId: 'adm',
    });
    expect(await activeFunction(db, 'fn.tela')).toBeNull();
    const listed = (await listFunctionDefs(db)).find((f) => f.name === 'fn.tela');
    expect(listed).toMatchObject({
      active: false,
      provider: null,
      model: null,
      effective: { provider: 'anthropic', model: defaultModelFor('anthropic') },
    });
  });
});
