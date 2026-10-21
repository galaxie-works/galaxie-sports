import type { FastifyInstance } from 'fastify';
import * as z from 'zod';
import { API_MODULES, API_PLANS, tenant, type Database } from '@galaxie/db';
import { inArray } from 'drizzle-orm';
import { problems } from '../errors.js';
import type { UsageBackend } from '../usage/counter.js';
import { UsageQuery } from '../usage/query.js';
import { persistUsage, queryUsage, usageByDay } from '../usage/store.js';
import { parseInput, UUID_RE } from '../util.js';
import type { AdminGuard } from './guard.js';
import type { PlanCatalog } from './plans.js';
import {
  createTenantFromPlan,
  getTenant,
  invalidScopes,
  issueKey,
  listKeys,
  listTenants,
  MAX_ROTATION_GRACE_SEC,
  revokeTenantKey,
  rotateKey,
  TenantConflictError,
  updateTenant,
} from './tenants.js';

export interface AdminRoutesOptions {
  db: Database;
  guard: AdminGuard;
  plans: PlanCatalog;
  usage?: UsageBackend | undefined;
}

// ─── Schemas de entrada (todas as rotas validam params, query e corpo com Zod) ────────────────────
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'slug: minúsculas, números e hífen (2–63)');
const Modules = z.array(z.enum(API_MODULES)).min(1).max(API_MODULES.length);
const Markets = z.array(z.string().regex(/^[A-Za-z]{2}$/, 'país ISO2')).max(60);
const Sports = z.array(z.string().regex(/^[a-z0-9-]{2,40}$/, 'slug de esporte')).max(40);
const RateLimit = z.number().int().min(1).max(1_000_000_000);
const Quota = z.number().int().min(1).max(2_000_000_000).nullable();
const Label = z.string().trim().min(1).max(80);
const KeyEnv = z.enum(['live', 'test']);
const FutureDate = z.iso
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .refine((d) => d.getTime() > Date.now(), 'expiresAt deve estar no futuro');

const NewKey = z
  .object({
    label: Label.optional(),
    scopes: Modules.optional(),
    env: KeyEnv.optional(),
    expiresAt: FutureDate.optional(),
  })
  .strict();

const CreateTenantBody = z
  .object({
    slug: Slug,
    name: z.string().trim().min(1).max(200),
    plan: z.enum(API_PLANS),
    modules: Modules.optional(),
    markets: Markets.optional(),
    sports: Sports.optional(),
    rateLimitPerMinute: RateLimit.optional(),
    dailyRequestQuota: Quota.optional(),
    key: z.union([NewKey, z.literal(false)]).optional(),
  })
  .strict();

const PatchTenantBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    plan: z.enum(API_PLANS).optional(),
    applyTemplate: z.boolean().optional(),
    modules: Modules.optional(),
    markets: Markets.optional(),
    sports: Sports.optional(),
    rateLimitPerMinute: RateLimit.optional(),
    dailyRequestQuota: Quota.optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'informe ao menos um campo');

const ListTenantsQuery = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  plan: z.enum(API_PLANS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

const TenantParams = z.object({ id: z.string().min(1).max(80) });
const KeyParams = z.object({ id: z.string().min(1).max(80), keyId: z.string().regex(UUID_RE, 'UUID') });
const RotateBody = z
  .object({ graceSeconds: z.number().int().min(0).max(MAX_ROTATION_GRACE_SEC).default(86_400) })
  .strict();

const SECRET_NOTICE = 'Guarde a chave agora: ela não será exibida novamente.';

/**
 * Rotas administrativas `/internal/admin/*` (onboarding de tenants, chaves e uso). Protegidas por
 * chave administrativa + allowlist de IP (AdminGuard); nunca recebem CORS e nunca são cacheadas.
 */
export async function adminRoutes(app: FastifyInstance, opts: AdminRoutesOptions): Promise<void> {
  const { db, guard, plans } = opts;
  const config = { admin: true } as const;

  app.addHook('onRequest', async (request) => guard.check(request));
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  const tenantOr404 = async (id: string) => {
    const t = await getTenant(db, id);
    if (!t) throw problems.notFound('Tenant');
    return t;
  };

  app.get('/internal/admin/plans', { config }, async () => ({ data: plans }));

  app.post('/internal/admin/tenants', { config }, async (request, reply) => {
    const body = parseInput(CreateTenantBody, request.body ?? {});
    const modules = body.modules ?? plans[body.plan].modules;
    const bad = body.key ? invalidScopes(modules, body.key.scopes) : [];
    if (bad.length)
      throw problems.invalidParams([
        { path: 'key.scopes', message: `fora dos módulos do tenant: ${bad.join(', ')}` },
      ]);
    try {
      const { key, ...input } = body;
      const created = await createTenantFromPlan(db, plans, {
        ...input,
        ...(key !== undefined ? { key } : {}),
      });
      request.log.info({ tenant: created.tenant.slug, admin: 'tenant.create' }, 'tenant criado');
      return reply.code(201).send({
        tenant: created.tenant,
        key: created.key ? { ...created.key, notice: SECRET_NOTICE } : null,
      });
    } catch (err) {
      if (err instanceof TenantConflictError) throw problems.conflict(err.message);
      throw err;
    }
  });

  app.get('/internal/admin/tenants', { config }, async (request) => {
    const q = parseInput(ListTenantsQuery, request.query);
    return {
      data: await listTenants(db, {
        limit: q.limit,
        offset: q.offset,
        ...(q.status ? { status: q.status } : {}),
        ...(q.plan ? { plan: q.plan } : {}),
      }),
    };
  });

  app.get('/internal/admin/tenants/:id', { config }, async (request) => {
    const { id } = parseInput(TenantParams, request.params);
    const t = await tenantOr404(id);
    return { tenant: t, keys: await listKeys(db, t.id) };
  });

  app.patch('/internal/admin/tenants/:id', { config }, async (request) => {
    const { id } = parseInput(TenantParams, request.params);
    const body = parseInput(PatchTenantBody, request.body ?? {});
    const updated = await updateTenant(db, plans, id, body);
    if (!updated) throw problems.notFound('Tenant');
    request.log.info(
      { tenant: updated.slug, admin: 'tenant.update', fields: Object.keys(body) },
      'tenant alterado',
    );
    return { tenant: updated };
  });

  app.post('/internal/admin/tenants/:id/keys', { config }, async (request, reply) => {
    const { id } = parseInput(TenantParams, request.params);
    const body = parseInput(NewKey, request.body ?? {});
    const t = await tenantOr404(id);
    const bad = invalidScopes(t.modules, body.scopes);
    if (bad.length)
      throw problems.invalidParams([
        { path: 'scopes', message: `fora dos módulos do tenant: ${bad.join(', ')}` },
      ]);
    const key = await issueKey(db, t.id, body);
    request.log.info({ tenant: t.slug, key: key.prefix, admin: 'key.issue' }, 'chave emitida');
    return reply.code(201).send({ key: { ...key, notice: SECRET_NOTICE } });
  });

  app.post('/internal/admin/tenants/:id/keys/:keyId/rotate', { config }, async (request, reply) => {
    const { id, keyId } = parseInput(KeyParams, request.params);
    const { graceSeconds } = parseInput(RotateBody, request.body ?? {});
    const t = await tenantOr404(id);
    const rotated = await rotateKey(db, t.id, keyId, { graceSeconds });
    if (!rotated) throw problems.notFound('Chave ativa');
    request.log.info(
      { tenant: t.slug, key: rotated.previous.prefix, admin: 'key.rotate' },
      'chave rotacionada',
    );
    return reply
      .code(201)
      .send({ key: { ...rotated.key, notice: SECRET_NOTICE }, previous: rotated.previous });
  });

  app.post('/internal/admin/tenants/:id/keys/:keyId/revoke', { config }, async (request) => {
    const { id, keyId } = parseInput(KeyParams, request.params);
    const t = await tenantOr404(id);
    if (!(await revokeTenantKey(db, t.id, keyId))) throw problems.notFound('Chave ativa');
    request.log.info({ tenant: t.slug, keyId, admin: 'key.revoke' }, 'chave revogada');
    return { revoked: true, keyId };
  });

  app.get('/internal/admin/tenants/:id/usage', { config }, async (request) => {
    const { id } = parseInput(TenantParams, request.params);
    const range = parseInput(UsageQuery, request.query);
    const t = await tenantOr404(id);
    const days = usageByDay(await queryUsage(db, opts.usage, { ...range, tenantId: t.id }));
    return {
      tenantId: t.id,
      slug: t.slug,
      ...range,
      dailyRequestQuota: t.dailyRequestQuota,
      total: days.reduce((n, d) => n + d.total, 0),
      days,
    };
  });

  app.get('/internal/admin/usage', { config }, async (request) => {
    const range = parseInput(UsageQuery, request.query);
    const rows = await queryUsage(db, opts.usage, range);
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.tenantId, (totals.get(r.tenantId) ?? 0) + r.requests);
    const ids = [...totals.keys()].filter((i) => UUID_RE.test(i));
    const slugs = new Map(
      ids.length
        ? (
            await db.select({ id: tenant.id, slug: tenant.slug }).from(tenant).where(inArray(tenant.id, ids))
          ).map((r) => [r.id, r.slug])
        : [],
    );
    return {
      ...range,
      tenants: [...totals]
        .map(([tenantId, total]) => ({ tenantId, slug: slugs.get(tenantId) ?? null, total }))
        .sort((a, b) => b.total - a.total),
    };
  });

  app.post('/internal/admin/usage/flush', { config }, async () => {
    if (!opts.usage) throw problems.degraded('Contadores de uso não configurados.');
    return persistUsage(db, opts.usage);
  });
}
