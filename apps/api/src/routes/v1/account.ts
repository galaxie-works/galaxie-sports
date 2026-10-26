import type { FastifyInstance, FastifyRequest } from 'fastify';
import { RotateKeyBody } from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import { getTenant, KeyRotationError, listKeys, rotateKey } from '../../admin/tenants.js';
import type { TenantContext } from '../../auth/authenticator.js';
import { problems } from '../../errors.js';
import type { UsageBackend } from '../../usage/counter.js';
import { UsageQuery } from '../../usage/query.js';
import { queryUsage, usageByDay } from '../../usage/store.js';
import { parseInput } from '../../util.js';

export interface AccountRoutesOptions {
  db: Database | undefined;
  usage?: UsageBackend | undefined;
}

/** Exige chave válida, mas nenhum módulo específico: todo tenant gerencia a própria conta. */
const config = { authenticated: true } as const;

function tenantOf(request: FastifyRequest): TenantContext {
  if (!request.tenant) throw problems.invalidKey();
  return request.tenant;
}

/**
 * Autoatendimento do tenant (docs/05 §1.2): dados do plano, chaves (sem segredos), rotação da
 * própria chave e uso por dia/rota. Respostas nunca são cacheadas.
 */
export async function accountRoutes(app: FastifyInstance, opts: AccountRoutesOptions): Promise<void> {
  const db = () => {
    if (!opts.db) throw problems.degraded('Banco de dados não configurado.');
    return opts.db;
  };

  app.addHook('onSend', async (request, reply) => {
    if (request.routeOptions.config?.authenticated) reply.header('cache-control', 'no-store');
  });

  app.get('/v1/account', { config }, async (request) => {
    const ctx = tenantOf(request);
    const t = await getTenant(db(), ctx.tenantId);
    if (!t) throw problems.invalidKey();
    const key = (await listKeys(db(), t.id)).find((k) => k.id === ctx.keyId);
    if (!key) throw problems.invalidKey();
    return {
      tenant: {
        id: t.id,
        slug: t.slug,
        name: t.name,
        plan: t.plan,
        modules: t.modules,
        markets: t.markets,
        sports: t.sports,
        rateLimitPerMinute: t.rateLimitPerMinute,
        dailyRequestQuota: t.dailyRequestQuota,
      },
      key: { ...key, effectiveModules: ctx.modules },
    };
  });

  app.get('/v1/account/keys', { config }, async (request) => {
    const ctx = tenantOf(request);
    return { data: await listKeys(db(), ctx.tenantId) };
  });

  app.post('/v1/account/keys/rotate', { config }, async (request, reply) => {
    const ctx = tenantOf(request);
    const { graceSeconds } = parseInput(RotateKeyBody.strict(), request.body ?? {});
    const rotated = await rotateKey(db(), ctx.tenantId, ctx.keyId, { graceSeconds }).catch((err) => {
      throw err instanceof KeyRotationError ? problems.conflict(err.message) : err;
    });
    if (!rotated) throw problems.invalidKey('Chave já revogada ou expirada.');
    request.log.info({ tenant: ctx.slug, key: rotated.previous.prefix }, 'chave rotacionada pelo tenant');
    return reply.code(201).send({
      key: { ...rotated.key, notice: 'Guarde a chave agora: ela não será exibida novamente.' },
      previous: rotated.previous,
    });
  });

  app.get('/v1/account/usage', { config }, async (request) => {
    const ctx = tenantOf(request);
    const range = parseInput(UsageQuery, request.query);
    const t = await getTenant(db(), ctx.tenantId);
    const days = usageByDay(await queryUsage(db(), opts.usage, { ...range, tenantId: ctx.tenantId }));
    return {
      ...range,
      dailyRequestQuota: t?.dailyRequestQuota ?? null,
      total: days.reduce((n, d) => n + d.total, 0),
      days,
    };
  });
}
