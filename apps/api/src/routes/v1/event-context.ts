import type { FastifyInstance } from 'fastify';
import {
  EVENT_CONTEXT_KINDS,
  EventContextQuery,
  EventParams,
  type EventContext,
  type EventContextSummary,
  type EventContextText,
  type SupportedLocale,
} from '@galaxie/contracts';
import { readEventContext, type Database, type EventContextRow } from '@galaxie/db';
import { assertSport } from '../../auth/authenticator.js';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { eventHead } from '../../events/queries.js';
import { formatInstant, resolveLocale } from '../../i18n.js';
import { parseInput } from '../../util.js';

const MODULE = { module: 'live_intelligence' } as const;

/**
 * Tag de purge do cenário/resumo: o trigger de `enrich.event_context` publica `event.context_published`
 * com a entidade `event_context:<evento>` (e a tag `event:<evento>`), que purga esta resposta e o detalhe.
 */
export const eventContextTag = (eventId: string) => `event_context:${eventId}`;

const isKind = (k: string): k is EventContextText['kind'] =>
  (EVENT_CONTEXT_KINDS as readonly string[]).includes(k);

function toText(row: EventContextRow, tz: string): EventContextText | undefined {
  if (!isKind(row.kind)) return undefined;
  const c = row.content;
  const generated = c.generatedAt ? new Date(c.generatedAt) : row.createdAt;
  return {
    kind: row.kind,
    locale: row.locale,
    text: c.text,
    sentences: Array.isArray(c.sentences) ? c.sentences : [c.text],
    origin: c.origin === 'llm' ? 'llm' : 'fallback',
    model: row.model,
    confidence: row.confidence,
    review_status: row.reviewStatus === 'reviewed' ? 'reviewed' : 'auto',
    generated_at: formatInstant(Number.isNaN(generated.getTime()) ? row.createdAt : generated, tz),
    fits: { tv: !!c.fits?.tv, mobile: !!c.fits?.mobile, web: !!c.fits?.web },
    sources: (row.sources ?? []).map((s) => ({ kind: s.kind, ref: s.ref, url: s.url ?? null })),
  };
}

/** Textos vigentes do evento no locale pedido (sem fallback entre locales: a copy é por mercado). */
export async function loadEventContexts(
  db: Database,
  eventId: string,
  locale: SupportedLocale,
  tz: string,
  kinds: readonly EventContextText['kind'][] = EVENT_CONTEXT_KINDS,
): Promise<EventContextText[]> {
  const rows = await readEventContext(db, eventId, { kinds, locales: [locale] });
  return rows.flatMap((r) => toText(r, tz) ?? []);
}

/** Resumo para o detalhe do evento (uma consulta indexada por evento). */
export async function eventContextSummary(
  db: Database,
  eventId: string,
  locale: SupportedLocale,
  tz: string,
): Promise<EventContextSummary> {
  const texts = await loadEventContexts(db, eventId, locale, tz);
  const brief = (kind: EventContextText['kind']) => {
    const t = texts.find((x) => x.kind === kind);
    return t ? { text: t.text, origin: t.origin, generated_at: t.generated_at } : null;
  };
  return { scenario: brief('scenario'), recap: brief('recap') };
}

/** GET /v1/events/{id}/context?locale=&kind=scenario|recap (docs/05 §3.2) — módulo live_intelligence. */
export async function eventContextRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/events/:id/context', { config: MODULE }, async (request, reply) => {
    const params = parseInput(EventParams, request.params);
    const query = parseInput(EventContextQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.context,
      vary: [locale, tz],
      // o esporte do evento (metadado do cache) também precisa estar no plano do tenant
      check: (meta) => {
        if (request.tenant && meta.sport) assertSport(request.tenant, meta.sport);
      },
      load: async () => {
        const db = requireDb(ctx);
        const head = await eventHead(db, params.id);
        const body: EventContext = {
          event_id: head.id,
          locale,
          data: await loadEventContexts(db, head.id, locale, tz, query.kind ? [query.kind] : undefined),
        };
        return {
          body,
          tags: [eventContextTag(head.id), `event:${head.id}`],
          meta: { sport: head.sport },
        };
      },
    });
  });
}
