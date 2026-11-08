import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  EventParams,
  LocaleQuery,
  OddsQuery,
  PREDICTION_COMPARISON_KEYS,
  type EventOdds,
  type EventPredictions,
  type OddsMarketKey,
  type Prediction,
} from '@galaxie/contracts';
import {
  asset,
  eventOdds,
  eventParticipant,
  eventPrediction,
  participant,
  type Database,
  type GoalsLine,
  type OddsMarket,
  type PredictionRecentForm,
} from '@galaxie/db';
import { teamLogoId } from '../../assets/custom-logos.js';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { eventHead } from '../../events/queries.js';
import { formatInstant } from '../../i18n.js';
import { loadTeamNames, teamNameOptions } from '../../teams/display-name.js';
import { assetUrl, parseInput } from '../../util.js';
import { localeOf, sportCheck } from './events.js';

/**
 * Palpite (`/v1/events/{id}/predictions`, módulo core_data) e odds pré-jogo (`/v1/events/{id}/odds`, módulo
 * add-on `odds`, em todos os mercados; só o consenso entre as casas, sem identificá-las) do jogo, de `core.event_prediction` e `core.event_odds` (docs/05 §3.2.2). O espelho busca os dois
 * uma vez por dia para os jogos das próximas 48 h: 1 h de cache acompanha essa cadência com folga.
 */
const PREDICTIONS_MODULE = { module: 'core_data' } as const;
const ODDS_MODULE = { module: 'odds' } as const;

type Side = 'home' | 'away';
type TeamRef = NonNullable<EventPredictions['home']>;

/** Mandante e visitante do jogo, no formato `ParticipantRef`. */
async function sides(
  db: Database,
  ctx: AppContext,
  eventId: string,
  locale: string,
): Promise<Record<Side, TeamRef | null> & { idOf: Map<string, Side> }> {
  const rows = await db
    .select({
      id: participant.id,
      name: participant.name,
      shortName: participant.shortName,
      side: eventParticipant.side,
      logoKey: asset.storageKey,
      logoUrl: asset.sourceUrl,
    })
    .from(eventParticipant)
    .innerJoin(participant, eq(participant.id, eventParticipant.participantId))
    .leftJoin(asset, eq(asset.id, teamLogoId(ctx.logos.enabled())))
    .where(and(eq(eventParticipant.eventId, eventId), sql`${eventParticipant.side} in ('home', 'away')`));
  const names = await loadTeamNames(
    db,
    rows.map((r) => r.id),
    teamNameOptions(ctx, locale),
  );
  const out: Record<Side, TeamRef | null> & { idOf: Map<string, Side> } = {
    home: null,
    away: null,
    idOf: new Map(),
  };
  for (const r of rows) {
    const side = r.side as Side;
    out[side] = {
      id: r.id,
      ...names.of(r.id, r.name),
      short_name: r.shortName,
      logo: assetUrl(ctx.assetsBaseUrl, r.logoKey, r.logoUrl),
    };
    out.idOf.set(r.id, side);
  }
  return out;
}

const line = (g: GoalsLine | undefined) => (g ? { side: g.side, line: g.line } : null);
const form = (f: PredictionRecentForm | undefined) =>
  f
    ? {
        form: f.form,
        attack: f.attack,
        defense: f.defense,
        goals_for: f.goalsFor,
        goals_against: f.goalsAgainst,
        goals_for_average: f.goalsForAverage,
        goals_against_average: f.goalsAgainstAverage,
      }
    : null;

/** Média com 2 casas (odd decimal). */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Consenso de cada mercado entre as casas: média, maior odd e quantas casas oferecem cada seleção. */
export function oddsConsensus(
  books: {
    markets: { key: OddsMarketKey; selections: { key: string; line: number | null; price: number }[] }[];
  }[],
): EventOdds['markets'] {
  const byMarket = new Map<
    OddsMarketKey,
    Map<string, { key: string; line: number | null; prices: number[] }>
  >();
  for (const b of books)
    for (const m of b.markets) {
      const sel = byMarket.get(m.key) ?? new Map();
      byMarket.set(m.key, sel);
      for (const s of m.selections) {
        const k = `${s.key}|${s.line ?? ''}`;
        const acc = sel.get(k) ?? { key: s.key, line: s.line, prices: [] };
        acc.prices.push(s.price);
        sel.set(k, acc);
      }
    }
  return [...byMarket].map(([key, sel]) => ({
    key,
    selections: [...sel.values()].map((s) => ({
      key: s.key,
      line: s.line,
      average: round2(s.prices.reduce((a, b) => a + b, 0) / s.prices.length),
      best: Math.max(...s.prices),
      bookmakers: s.prices.length,
    })),
  }));
}

/** Só os mercados com chave nossa (e, com filtro, só os pedidos), na ordem do fornecedor. */
export function publicMarkets(markets: OddsMarket[], only?: readonly OddsMarketKey[]) {
  return markets
    .filter((m): m is OddsMarket & { key: OddsMarketKey } => m.key != null && (!only || only.includes(m.key)))
    .map((m) => ({
      key: m.key,
      selections: m.selections.map((s) => ({ key: s.key, line: s.line, price: s.price })),
    }));
}

export async function marketsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // ─── /v1/events/:id/predictions ──────────────────────────────────────────────────────────────
  app.get('/v1/events/:id/predictions', { config: PREDICTIONS_MODULE }, async (request, reply) => {
    const params = parseInput(EventParams, request.params);
    const query = parseInput(LocaleQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale, tz],
      check: sportCheck(request),
      load: async () => {
        const db = requireDb(ctx);
        const head = await eventHead(db, params.id);
        const [teams, [row]] = await Promise.all([
          sides(db, ctx, head.id, locale),
          db.select().from(eventPrediction).where(eq(eventPrediction.eventId, head.id)),
        ]);
        let prediction: Prediction | null = null;
        if (row) {
          const winnerSide = row.winnerParticipantId ? teams.idOf.get(row.winnerParticipantId) : undefined;
          const cmp = row.comparison ?? {};
          prediction = {
            winner:
              winnerSide && row.winnerParticipantId
                ? { side: winnerSide, participant_id: row.winnerParticipantId, win_or_draw: !!row.winOrDraw }
                : null,
            probabilities: { home: row.probHome, draw: row.probDraw, away: row.probAway },
            goals: {
              total: line(row.goals?.total),
              home: line(row.goals?.home),
              away: line(row.goals?.away),
            },
            comparison: PREDICTION_COMPARISON_KEYS.flatMap((key) => {
              const c = cmp[key];
              return c ? [{ key, home: c.home, away: c.away }] : [];
            }),
            recent_form: { home: form(row.recentForm?.home), away: form(row.recentForm?.away) },
          };
        }
        const body: EventPredictions = {
          event_id: head.id,
          sport: head.sport,
          home: teams.home,
          away: teams.away,
          prediction,
          updated_at: row ? formatInstant(row.observedAt, tz) : null,
        };
        return { body, tags: [`event:${head.id}`], meta: { sport: head.sport } };
      },
    });
  });

  // ─── /v1/events/:id/odds ─────────────────────────────────────────────────────────────────────
  app.get('/v1/events/:id/odds', { config: ODDS_MODULE }, async (request, reply) => {
    const params = parseInput(EventParams, request.params);
    const query = parseInput(OddsQuery, request.query);
    const locale = localeOf(request, query);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale, tz, (query.market ?? []).join(',')],
      check: sportCheck(request),
      load: async () => {
        const db = requireDb(ctx);
        const head = await eventHead(db, params.id);
        const [teams, rows] = await Promise.all([
          sides(db, ctx, head.id, locale),
          db
            .select({
              markets: eventOdds.markets,
              sourceUpdatedAt: eventOdds.sourceUpdatedAt,
              observedAt: eventOdds.observedAt,
            })
            .from(eventOdds)
            .where(eq(eventOdds.eventId, head.id)),
        ]);
        const books = rows
          .map((r) => ({
            markets: publicMarkets(r.markets, query.market),
            updatedAt: r.sourceUpdatedAt ?? r.observedAt,
          }))
          .filter((b) => b.markets.length);
        const latest = books.reduce<Date | null>(
          (acc, b) => (!acc || b.updatedAt > acc ? b.updatedAt : acc),
          null,
        );
        const body: EventOdds = {
          event_id: head.id,
          sport: head.sport,
          home: teams.home,
          away: teams.away,
          markets: oddsConsensus(books),
          // decisão do dono (07/11): as casas não são identificadas, só o consenso sai
          bookmakers: books.length,
          updated_at: latest ? formatInstant(latest, tz) : null,
        };
        return { body, tags: [`event:${head.id}`], meta: { sport: head.sport } };
      },
    });
  });
}
