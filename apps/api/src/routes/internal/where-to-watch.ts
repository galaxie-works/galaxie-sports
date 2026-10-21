/**
 * Rotas internas do onde assistir (issue #51 e #52) — chave administrativa (x-galaxie-admin-key).
 *
 *   GET    /internal/where-to-watch/events/:id?country=BR[&history=true]   estado vigente (+ histórico)
 *   POST   /internal/where-to-watch/events/:id/options                     inclui opção (editorial)
 *   PATCH  /internal/where-to-watch/options/:optionId                      corrige opção vigente
 *   DELETE /internal/where-to-watch/options/:optionId                      remove opção (lápide editorial)
 *   POST   /internal/where-to-watch/events/:id/rerun                       reprocessa (fila do agente)
 *   GET    /internal/where-to-watch/audits                                 fila de auditoria pendente
 *   POST   /internal/where-to-watch/audits/:auditId                        registra veredito
 *   GET    /internal/where-to-watch/metrics[?format=prometheus]           métricas e metas (docs/07 §4)
 *
 * Toda correção grava trilha em enrich.broadcast_correction e publica `where_to_watch.changed`
 * no change feed (purge do cache da API em segundos; SLA ≤ 5 min).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as z from 'zod';
import { ACCESS_MODELS, BROADCAST_MEDIA } from '@galaxie/contracts';
import { broadcastCorrection, event, wtwRun, type Database } from '@galaxie/db';
import {
  addOption,
  AUDIT_VERDICTS,
  computeWtwMetrics,
  correctOption,
  currentOptions,
  listPendingAudits,
  optionHistory,
  queueRerun,
  recordVerdict,
  removeOption,
  renderPrometheus,
  WtwError,
  type BroadcastOptionRow,
} from '@galaxie/where-to-watch';
import { assertAdmin } from '../../auth/admin-key.js';

/** Rotas internas: protegidas pelo AdminGuard (auditoria de segurança verifica `config.admin`). */
const ADMIN_ROUTE = { admin: true } as const;
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { parseInput } from '../../util.js';

const Country = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .transform((s) => s.toUpperCase());
const EventParams = z.object({ id: z.uuid() });
const OptionParams = z.object({ optionId: z.uuid() });
const Evidence = z.array(z.object({ url: z.url(), excerpt: z.string().max(400).optional() })).max(10);
const Reason = z.string().trim().min(3).max(500);
const ReportedAt = z.iso.datetime({ offset: true }).optional();

const AddBody = z.object({
  country: Country,
  region: z.string().trim().max(40).nullable().optional(),
  provider: z.string().trim().min(1).max(80),
  provider_id: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .nullable()
    .optional(),
  channel: z.string().trim().max(80).nullable().optional(),
  medium: z.enum(BROADCAST_MEDIA),
  access_model: z.enum(ACCESS_MODELS),
  watch_url: z.url().nullable().optional(),
  language: z.string().max(10).nullable().optional(),
  evidence: Evidence.optional(),
  reason: Reason,
  reported_at: ReportedAt,
});

const PatchBody = z.object({
  provider: z.string().trim().min(1).max(80).optional(),
  provider_id: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .nullable()
    .optional(),
  channel: z.string().trim().max(80).nullable().optional(),
  medium: z.enum(BROADCAST_MEDIA).optional(),
  access_model: z.enum(ACCESS_MODELS).optional(),
  watch_url: z.url().nullable().optional(),
  region: z.string().trim().max(40).nullable().optional(),
  language: z.string().max(10).nullable().optional(),
  status: z.enum(['confirmed', 'pending', 'omitted']).optional(),
  evidence: Evidence.optional(),
  reason: Reason,
  reported_at: ReportedAt,
});

const RemoveBody = z.object({ reason: Reason, reported_at: ReportedAt });
const RerunBody = z.object({
  country: Country,
  mode: z.enum(['full', 'revalidate']).optional(),
  reason: Reason,
});
const StateQuery = z.object({ country: Country, history: z.enum(['true', 'false']).optional() });
const VerdictBody = z.object({ verdict: z.enum(AUDIT_VERDICTS), note: z.string().max(500).optional() });
const MetricsQuery = z.object({
  format: z.enum(['json', 'prometheus']).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  countries: z
    .string()
    .regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/)
    .optional(),
});

function serialize(row: BroadcastOptionRow) {
  return {
    id: row.id,
    country: row.countryCode,
    region: row.region,
    provider: row.providerName,
    provider_id: row.broadcasterId,
    channel: row.channelName,
    medium: row.medium,
    access_model: row.accessModel,
    watch_url: row.url,
    status: row.status,
    confidence: Number(row.confidence),
    conflict: row.conflict,
    flags: row.flags,
    source_kind: row.sourceKind,
    evidence: row.evidence,
    produced_by: row.producedBy,
    run_id: row.runId,
    first_seen_at: row.firstSeenAt.toISOString(),
    last_verified_at: row.lastVerifiedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    superseded_by: row.supersededBy,
    superseded_at: row.supersededAt?.toISOString() ?? null,
  };
}

function mapError(err: unknown): never {
  if (err instanceof WtwError) {
    if (err.code === 'not_found') throw problems.notFound('Opção');
    if (err.code === 'conflict') throw problems.conflict(err.message);
    throw problems.invalidParams([], err.message);
  }
  throw err;
}

async function assertEvent(db: Database, id: string): Promise<void> {
  const [row] = await db.select({ id: event.id }).from(event).where(eq(event.id, id));
  if (!row) throw problems.notFound('Evento');
}

const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');

export async function internalWhereToWatchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(async (internal) => {
    internal.decorateRequest('actor', '');
    internal.addHook('onRequest', async (request: FastifyRequest) => {
      (request as FastifyRequest & { actor: string }).actor = assertAdmin(request, ctx.adminGuard);
    });
    const actorOf = (r: FastifyRequest) => (r as FastifyRequest & { actor: string }).actor;
    const blocklist = () => ctx.wtwConfig?.().blocklist;

    internal.get('/internal/where-to-watch/events/:id', { config: ADMIN_ROUTE }, async (request, reply) => {
      const db = requireDb(ctx);
      const { id } = parseInput(EventParams, request.params);
      const q = parseInput(StateQuery, request.query);
      await assertEvent(db, id);
      const current = await currentOptions(db, id, q.country);
      const body: Record<string, unknown> = {
        event_id: id,
        country: q.country,
        options: current.map(serialize),
        runs: (
          await db
            .select()
            .from(wtwRun)
            .where(and(eq(wtwRun.eventId, id), eq(wtwRun.countryCode, q.country)))
            .orderBy(desc(wtwRun.createdAt))
            .limit(20)
        ).map((r) => ({
          id: r.id,
          window: r.window,
          mode: r.mode,
          status: r.status,
          requested_by: r.requestedBy,
          finished_at: r.finishedAt?.toISOString() ?? null,
          error: r.error,
          stats: r.stats,
        })),
      };
      if (q.history === 'true') {
        body.history = (await optionHistory(db, id, q.country)).map(serialize);
        body.corrections = await db
          .select()
          .from(broadcastCorrection)
          .where(and(eq(broadcastCorrection.eventId, id), eq(broadcastCorrection.countryCode, q.country)))
          .orderBy(desc(broadcastCorrection.createdAt));
      }
      return noStore(reply).send(body);
    });

    internal.post(
      '/internal/where-to-watch/events/:id/options',
      { config: ADMIN_ROUTE },
      async (request, reply) => {
        const db = requireDb(ctx);
        const { id } = parseInput(EventParams, request.params);
        const b = parseInput(AddBody, request.body);
        await assertEvent(db, id);
        const bl = blocklist();
        const r = await addOption(db, {
          eventId: id,
          country: b.country,
          region: b.region ?? null,
          providerName: b.provider,
          broadcasterId: b.provider_id ?? null,
          channel: b.channel ?? null,
          medium: b.medium,
          accessModel: b.access_model,
          url: b.watch_url ?? null,
          language: b.language ?? null,
          ...(b.evidence
            ? {
                evidence: b.evidence.map((e) => ({
                  url: e.url,
                  ...(e.excerpt ? { excerpt: e.excerpt } : {}),
                })),
              }
            : {}),
          actor: actorOf(request),
          reason: b.reason,
          reportedAt: b.reported_at ? new Date(b.reported_at) : null,
          ...(bl ? { blocklist: bl } : {}),
        }).catch(mapError);
        return noStore(reply)
          .code(201)
          .send({
            option: serialize(r.option!),
            previous_option_id: r.previous?.id ?? null,
            correction_id: r.correctionId,
            change_id: r.changeId,
          });
      },
    );

    internal.patch(
      '/internal/where-to-watch/options/:optionId',
      { config: ADMIN_ROUTE },
      async (request, reply) => {
        const db = requireDb(ctx);
        const { optionId } = parseInput(OptionParams, request.params);
        const b = parseInput(PatchBody, request.body);
        const bl = blocklist();
        const patch = {
          ...(b.provider !== undefined ? { providerName: b.provider } : {}),
          ...(b.provider_id !== undefined ? { broadcasterId: b.provider_id } : {}),
          ...(b.channel !== undefined ? { channel: b.channel } : {}),
          ...(b.medium !== undefined ? { medium: b.medium } : {}),
          ...(b.access_model !== undefined ? { accessModel: b.access_model } : {}),
          ...(b.watch_url !== undefined ? { url: b.watch_url } : {}),
          ...(b.region !== undefined ? { region: b.region } : {}),
          ...(b.language !== undefined ? { language: b.language } : {}),
          ...(b.status !== undefined ? { status: b.status } : {}),
          ...(b.evidence
            ? {
                evidence: b.evidence.map((e) => ({
                  url: e.url,
                  ...(e.excerpt ? { excerpt: e.excerpt } : {}),
                })),
              }
            : {}),
        };
        const r = await correctOption(db, optionId, patch, {
          actor: actorOf(request),
          reason: b.reason,
          reportedAt: b.reported_at ? new Date(b.reported_at) : null,
          ...(bl ? { blocklist: bl } : {}),
        }).catch(mapError);
        return noStore(reply).send({
          option: serialize(r.option!),
          previous_option_id: r.previous?.id ?? null,
          correction_id: r.correctionId,
          change_id: r.changeId,
        });
      },
    );

    internal.delete(
      '/internal/where-to-watch/options/:optionId',
      { config: ADMIN_ROUTE },
      async (request, reply) => {
        const db = requireDb(ctx);
        const { optionId } = parseInput(OptionParams, request.params);
        const b = parseInput(RemoveBody, request.body ?? {});
        const r = await removeOption(db, optionId, {
          actor: actorOf(request),
          reason: b.reason,
          reportedAt: b.reported_at ? new Date(b.reported_at) : null,
        }).catch(mapError);
        return noStore(reply).send({
          option: serialize(r.option!),
          previous_option_id: r.previous?.id ?? null,
          correction_id: r.correctionId,
          change_id: r.changeId,
        });
      },
    );

    internal.post(
      '/internal/where-to-watch/events/:id/rerun',
      { config: ADMIN_ROUTE },
      async (request, reply) => {
        const db = requireDb(ctx);
        const { id } = parseInput(EventParams, request.params);
        const b = parseInput(RerunBody, request.body);
        await assertEvent(db, id);
        const r = await queueRerun(db, {
          eventId: id,
          country: b.country,
          actor: actorOf(request),
          reason: b.reason,
          ...(b.mode ? { mode: b.mode } : {}),
        }).catch(mapError);
        return noStore(reply)
          .code(202)
          .send({ run_id: r.runId, correction_id: r.correctionId, status: 'queued' });
      },
    );

    internal.get('/internal/where-to-watch/audits', { config: ADMIN_ROUTE }, async (_request, reply) => {
      const db = requireDb(ctx);
      return noStore(reply).send({ data: await listPendingAudits(db) });
    });

    internal.post(
      '/internal/where-to-watch/audits/:auditId',
      { config: ADMIN_ROUTE },
      async (request, reply) => {
        const db = requireDb(ctx);
        const { auditId } = parseInput(z.object({ auditId: z.uuid() }), request.params);
        const b = parseInput(VerdictBody, request.body);
        await recordVerdict(db, auditId, {
          verdict: b.verdict,
          reviewer: actorOf(request),
          note: b.note ?? null,
        }).catch(mapError);
        return noStore(reply).send({ audit_id: auditId, verdict: b.verdict });
      },
    );

    internal.get('/internal/where-to-watch/metrics', { config: ADMIN_ROUTE }, async (request, reply) => {
      const db = requireDb(ctx);
      const q = parseInput(MetricsQuery, request.query);
      const countries = q.countries
        ? q.countries.toUpperCase().split(',')
        : (ctx.wtwConfig?.().countries ?? []);
      const m = await computeWtwMetrics(db, { countries, ...(q.days ? { days: q.days } : {}) });
      noStore(reply);
      if (q.format === 'prometheus')
        return reply
          .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
          .send(renderPrometheus(m));
      return reply.send(m);
    });
  });
}
