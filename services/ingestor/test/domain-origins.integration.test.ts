/**
 * `pgDomainStore.addOrigins` (F3, decisão 12) contra o banco: um só UPDATE por chave acrescenta às chaves publicáveis
 * `live` ativas da marca as origens que faltam, sem reler a lista (uma edição simultânea do painel não se perde),
 * ignora as de teste e as revogadas, e não muda nada na segunda vez.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createPublishableKey,
  publishableKey,
  revokePublishableKey,
  tenant,
  type Database,
} from '@galaxie/db';
import { originsForHost, pgDomainStore } from '../src/tasks/domain.js';
import { disposableDb } from './db.js';

const temp = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await temp.setup();
}, 90_000);
afterAll(async () => {
  await temp.teardown();
});

const originsOf = async (id: string) =>
  (
    await db
      .select({ o: publishableKey.allowedOrigins })
      .from(publishableKey)
      .where(eq(publishableKey.id, id))
  )[0]!.o;

describe('addOrigins', () => {
  it('acrescenta só o que falta, só nas chaves live ativas da marca; de novo, nada muda', async () => {
    const [t] = await db
      .insert(tenant)
      .values({ slug: 'dom-origens', name: 'Origens', plan: 'fan_experience', modules: ['core_data'] })
      .returning({ id: tenant.id });
    const [other] = await db
      .insert(tenant)
      .values({ slug: 'dom-outra', name: 'Outra', plan: 'fan_experience', modules: ['core_data'] })
      .returning({ id: tenant.id });
    const a = await createPublishableKey(db, {
      tenantId: t!.id,
      name: 'A',
      allowedOrigins: ['https://a.test'],
    });
    const b = await createPublishableKey(db, {
      tenantId: t!.id,
      name: 'B',
      allowedOrigins: ['https://www.exemplo.com', 'https://b.test'],
    });
    const test = await createPublishableKey(db, {
      tenantId: t!.id,
      name: 'T',
      env: 'test',
      allowedOrigins: ['http://localhost:3000'],
    });
    const revoked = await createPublishableKey(db, {
      tenantId: t!.id,
      name: 'R',
      allowedOrigins: ['https://r.test'],
    });
    await revokePublishableKey(db, t!.id, revoked.id, 'teste');
    const foreign = await createPublishableKey(db, {
      tenantId: other!.id,
      name: 'F',
      allowedOrigins: ['https://f.test'],
    });

    const origins = originsForHost('exemplo.com');
    expect(await pgDomainStore.addOrigins(db, t!.id, origins)).toBe(2);
    expect(await originsOf(a.id)).toEqual([
      'https://a.test',
      'https://exemplo.com',
      'https://www.exemplo.com',
    ]);
    // a B já tinha o www.: só o host entra, sem repetir
    expect(await originsOf(b.id)).toEqual([
      'https://www.exemplo.com',
      'https://b.test',
      'https://exemplo.com',
    ]);
    expect(await originsOf(test.id)).toEqual(['http://localhost:3000']);
    expect(await originsOf(revoked.id)).toEqual(['https://r.test']);
    expect(await originsOf(foreign.id)).toEqual(['https://f.test']);

    // idempotente
    expect(await pgDomainStore.addOrigins(db, t!.id, origins)).toBe(0);
    expect(await originsOf(a.id)).toHaveLength(3);
    expect(await pgDomainStore.addOrigins(db, t!.id, [])).toBe(0);
  });
});
