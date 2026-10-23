import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  publishChange,
  reviewDecision,
  reviewItem,
  runMigrations,
  teamProfile,
  type Database,
} from '@galaxie/db';
import { loadKnowledge, seedSemantic, type KnowledgeBase } from '@galaxie/knowledge';
import { createApiKey, upsertTenant } from '../src/auth/admin.js';
import { buildServer } from '../src/server.js';

/*
 * Painel de revisão semântica × API de produção (piso `approved`, docs/06 §2.1): o que o painel grava
 * (decisão, status nas tabelas e aviso no change feed — o mesmo que apps/demo/src/lib/review/store.ts)
 * aparece na API sem novo deploy, com o cache purgado, e continua valendo depois do próximo seed.
 */

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();
const keyPrefix = `gs-test-${randomBytes(4).toString('hex')}:`;

let admin: postgres.Sql;
let db: Database;
let redis: Redis;
let app: FastifyInstance;
let key: string;
let kb: KnowledgeBase;

const get = (url: string) => app.inject({ method: 'GET', url, headers: { 'x-galaxie-key': key } });

/** O que o painel faz ao decidir (apps/demo/src/lib/review/store.ts), em uma transação. */
async function panelDecides(itemId: string, status: 'approved' | 'draft') {
  await db.transaction(async (tx) => {
    const [item] = await tx.select().from(reviewItem).where(eq(reviewItem.id, itemId));
    await tx
      .insert(reviewDecision)
      .values({ itemId, status, reviewHash: item!.reviewHash, decidedBy: 'teste.admin@galaxie.test' })
      .onConflictDoUpdate({ target: reviewDecision.itemId, set: { status, reviewHash: item!.reviewHash } });
    if (item!.kind === 'team') {
      await tx.update(teamProfile).set({ reviewStatus: status }).where(eq(teamProfile.slug, item!.key));
      await publishChange(tx, { topic: 'semantic.review', entityType: 'team_profile', entityId: item!.key });
    } else if (item!.kind === 'glossary') {
      await publishChange(tx, { topic: 'semantic.review', entityType: 'glossary', entityId: item!.key });
    }
  });
}

/** Espera o change feed purgar o cache e a resposta mudar. */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return read();
}

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 5 });
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  kb = await loadKnowledge();
  await seedSemantic(db, kb);
  // o teste parte de itens em rascunho, seja qual for o status do YAML
  await db.update(teamProfile).set({ reviewStatus: 'draft' }).where(eq(teamProfile.slug, 'palmeiras'));
  const t = await upsertTenant(db, {
    slug: 'demo',
    name: 'Demo',
    plan: 'enterprise',
    rateLimitPerMinute: 1000,
  });
  key = (await createApiKey(db, t.id, { env: 'test' })).key;
  // piso padrão de produção (approved) e o consumidor do change feed ligado
  app = buildServer({ db, redis, keyPrefix, changeFeed: { pollIntervalMs: 100 } });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  if (redis) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${keyPrefix}*`, 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    redis.disconnect();
  }
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('aprovação pelo painel', () => {
  it('perfil aprovado aparece na API na hora e o próximo deploy não desfaz', async () => {
    expect((await get('/v1/teams/palmeiras/semantic')).statusCode).toBe(404);

    await panelDecides('team:palmeiras', 'approved');
    const res = await eventually(
      () => get('/v1/teams/palmeiras/semantic'),
      (r) => r.statusCode === 200,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ slug: 'palmeiras', review_status: 'approved' });

    // novo deploy: o seed roda de novo com o YAML do repositório
    await seedSemantic(db, kb);
    const [row] = await db
      .select({ s: teamProfile.reviewStatus })
      .from(teamProfile)
      .where(eq(teamProfile.slug, 'palmeiras'));
    expect(row!.s).toBe('approved');
    expect((await get('/v1/teams/palmeiras/semantic')).statusCode).toBe(200);
  });

  it('voltar para rascunho tira o perfil da API (cache purgado pela tag do perfil)', async () => {
    expect((await get('/v1/teams/palmeiras/semantic')).statusCode).toBe(200);
    await panelDecides('team:palmeiras', 'draft');
    const res = await eventually(
      () => get('/v1/teams/palmeiras/semantic'),
      (r) => r.statusCode === 404,
    );
    expect(res.statusCode).toBe(404);
  });

  it('glossário: a API aplica a decisão por cima do YAML', async () => {
    const term = kb.glossary.find((g) => g.locale === 'pt-BR' && g.entry.review_status !== 'approved');
    if (!term) return; // base inteira já aprovada no YAML: nada a decidir
    const before = (await get('/v1/glossary?locale=pt-BR')).json().data as { key: string }[];
    expect(before.map((t) => t.key)).not.toContain(term.entry.key);

    await panelDecides(`glossary:pt-BR.${term.entry.key}`, 'approved');
    const after = await eventually(
      async () =>
        (await get('/v1/glossary?locale=pt-BR')).json().data as { key: string; review_status: string }[],
      (data) => data.some((t) => t.key === term.entry.key),
    );
    expect(after.find((t) => t.key === term.entry.key)).toMatchObject({ review_status: 'approved' });
  });
});
