import { randomBytes } from 'node:crypto';
import { tenant, type Database } from '@galaxie/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cancelCreditRequest,
  createCreditRequest,
  decideCreditRequest,
  isCosmosError,
  listCreditRequests,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;

async function newTenant(): Promise<string> {
  const [row] = await db
    .insert(tenant)
    .values({
      slug: `t-${randomBytes(4).toString('hex')}`,
      name: 'Clube',
      plan: 'enterprise',
      modules: ['core_data'],
      markets: ['BR'],
    })
    .returning({ id: tenant.id });
  return row!.id;
}

const expectCode = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => isCosmosError(e) && e.code === code);

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
});
afterAll(async () => temp?.close());

describe('pedido de créditos ao dono (#996)', () => {
  it('abre com justificativa; a mesma pessoa não abre dois ao mesmo tempo', async () => {
    const t = await newTenant();
    await expectCode(
      createCreditRequest(db, { tenantId: t, userId: 'mod', reason: ' oi ' }),
      'reason_required',
    );
    const r = await createCreditRequest(db, {
      tenantId: t,
      userId: 'mod',
      reason: '  Jogo grande no domingo  ',
    });
    expect(r).toMatchObject({ status: 'open', reason: 'Jogo grande no domingo', decidedAt: null });
    await expectCode(
      createCreditRequest(db, { tenantId: t, userId: 'mod', reason: 'De novo, por favor' }),
      'request_open',
    );
    // outra pessoa pode pedir
    await createCreditRequest(db, { tenantId: t, userId: 'mod2', reason: 'Final do estadual' });
    expect(await listCreditRequests(db, t, { status: ['open'] })).toHaveLength(2);
  });

  it('aprovar e recusar fecham o pedido com quem decidiu; pedido fechado não anda de novo', async () => {
    const t = await newTenant();
    const a = await createCreditRequest(db, { tenantId: t, userId: 'mod', reason: 'Clássico no sábado' });
    const approved = await decideCreditRequest(db, {
      tenantId: t,
      requestId: a.id,
      decision: 'approved',
      userId: 'dono',
    });
    expect(approved).toMatchObject({ status: 'approved', decidedBy: 'dono' });
    expect(approved.decidedAt).toBeInstanceOf(Date);
    await expectCode(
      decideCreditRequest(db, { tenantId: t, requestId: a.id, decision: 'declined', userId: 'dono' }),
      'request_closed',
    );
    // com o anterior fechado, a pessoa pode pedir de novo
    const b = await createCreditRequest(db, { tenantId: t, userId: 'mod', reason: 'Mais um jogo grande' });
    const declined = await decideCreditRequest(db, {
      tenantId: t,
      requestId: b.id,
      decision: 'declined',
      userId: 'dono',
      note: 'Saldo dá para o mês',
    });
    expect(declined).toMatchObject({ status: 'declined', decisionNote: 'Saldo dá para o mês' });
    expect((await listCreditRequests(db, t, { requestedBy: 'mod' })).map((r) => r.status)).toEqual([
      'declined',
      'approved',
    ]);
  });

  it('outro tenant não decide; só quem pediu cancela', async () => {
    const t = await newTenant();
    const other = await newTenant();
    const r = await createCreditRequest(db, { tenantId: t, userId: 'mod', reason: 'Rodada dupla' });
    await expectCode(
      decideCreditRequest(db, { tenantId: other, requestId: r.id, decision: 'approved', userId: 'x' }),
      'request_closed',
    );
    await expectCode(
      cancelCreditRequest(db, { tenantId: t, requestId: r.id, userId: 'outro' }),
      'request_closed',
    );
    expect(await cancelCreditRequest(db, { tenantId: t, requestId: r.id, userId: 'mod' })).toMatchObject({
      status: 'canceled',
    });
  });
});
