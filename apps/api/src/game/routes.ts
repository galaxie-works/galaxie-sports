/**
 * Palpite individual e Ranking da Gamificação (#942), com o token `gft_` do torcedor:
 *
 * - `GET /v1/predictions/open?event_id=`: prazo, tipos, Piso e os Palpites do torcedor no jogo.
 * - `PUT /v1/predictions/{eventId}`: grava ou troca até o prazo (relógio do banco). Grátis, sem compra.
 * - `GET /v1/rankings/{period}` e `.../me`: Ranking único do cliente no país, pelos Pontos definitivos.
 * - Para o servidor do cliente (chave secreta, #913): `GET /v1/fans/{conta}/profiles/{perfil}/game` (Pontos, Nível,
 *   Conquistas e Cartas de um Perfil pelos ids do sistema dele) e `GET /v1/game/rankings/{period}?country=`.
 * - `GET /v1/achievements`: o Catálogo ativo do programa, para a estante mostrar também as bloqueadas (#919).
 *
 * Esportes do MVP: futebol, basquete (e NBA) e futebol americano. Menor de 13 fica fora (portão de idade da rota,
 * capacidade `predict`); 13 a 17 palpita e pontua.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  PredictionEventParams,
  PredictionOpenQuery,
  PredictionsBody,
  RankingParams,
  RankingQuery,
  AchievementCatalogQuery,
  AchievementEarnersParams,
  GameFanParams,
  GameRankingServerQuery,
  AchievementEarnersQuery,
  type AchievementCatalog,
  type AchievementEarners,
  type FanAchievements,
  type FanCards,
  type FanGameSummary,
  type MyRanking,
  type OpenPredictions,
  type PredictionInput,
  type PredictionView,
  type Ranking,
  type SavedPredictions,
} from '@galaxie/contracts';
import {
  activeAchievements,
  readAchievementEarners,
  event,
  readFanAchievements,
  readFanCards,
  levelForPoints,
  peakPoints,
  readWallets,
  readMyRanking,
  readPredictions,
  readProgramCatalog,
  readRanking,
  savePredictions,
  type Database,
  type GamePredictionRow,
} from '@galaxie/db';
import {
  PREDICTION_SPORTS,
  countryTimeZone,
  predictionSubject,
  quantityFloors,
  validatePrediction,
  type PredictionValue,
} from '@galaxie/game-rules';
import { eq } from 'drizzle-orm';
import { problems } from '../errors.js';
import { parseInput } from '../util.js';
import { findFanByExternal, readFan } from '../engage/fans.js';
import { programCountryFor, resolveProgram, tenantHasGamification } from './program.js';

/** Jogo que aceita Palpite enquanto não começa. */
const PREDICTABLE_STATUSES = new Set(['scheduled', 'postponed']);

export interface GameRoutesDeps {
  db: Database | undefined;
  now?: (() => Date) | undefined;
}

/** O Palpite no formato da API (camelCase do corpo) para o das regras e de volta. */
function toRules(p: PredictionInput): PredictionValue {
  return p.kind === 'quantity' ? { kind: 'quantity', subject: p.subject, atLeast: p.atLeast } : p;
}

function view(row: GamePredictionRow): PredictionView {
  return {
    kind: row.kind,
    value: row.value as PredictionInput,
    state: row.state,
    points: row.finalPoints ?? row.provisionalPoints,
    full_hit: row.fullHit,
  };
}

/**
 * Chave secreta do servidor do cliente (não vale a publicável nem o token do torcedor), com a Gamificação no que a
 * chave alcança: o escopo da chave e o acordo comercial já estão em `request.tenant.modules`.
 */
function secretTenantId(request: FastifyRequest): string {
  const t = request.tenant;
  if (!t || t.keyKind !== 'secret' || !t.keyPrefix)
    throw problems.invalidKey('Use a chave secreta no header x-galaxie-key, no seu servidor.');
  if (!t.modules.includes('gamification')) throw problems.moduleNotInPlan('gamification');
  return t.tenantId;
}

type AchievementRows = Awaited<ReturnType<typeof readFanAchievements>>;
type ActiveRows = Awaited<ReturnType<typeof activeAchievements>>;
type CardRows = Awaited<ReturnType<typeof readFanCards>>;

function achievementsView(
  rows: AchievementRows,
  active: ActiveRows,
): FanAchievements['data']['achievements'] {
  const thresholds = new Map(active.map((a) => [a.id, a.thresholds]));
  return rows.map((r) => ({
    achievement_id: r.achievementId,
    season: r.season,
    count: r.count,
    steps: r.steps,
    next_threshold: thresholds.get(r.achievementId)?.[r.steps] ?? null,
    rarity: r.rarity,
  }));
}

function cardsView(cards: CardRows): FanCards['data']['cards'] {
  return cards.map((c) => ({
    card_key: c.cardKey,
    achievement_id: c.achievementId,
    season: c.season,
    step: c.step,
    granted_at: c.grantedAt.toISOString(),
  }));
}

/** `current-month` e `current-year` viram o período no fuso do programa (a virada do mês vale lá, não no navegador). */
export function resolveRankingPeriod(period: string, timeZone: string, now: Date): string {
  if (period !== 'current-month' && period !== 'current-year') return period;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return period === 'current-year' ? year : `${year}-${month}`;
}

export async function gameRoutes(app: FastifyInstance, deps: GameRoutesDeps): Promise<void> {
  const db = () => {
    if (!deps.db) throw problems.degraded('Banco de dados não configurado.');
    return deps.db;
  };
  const now = () => deps.now?.() ?? new Date();

  /** Torcedor com o módulo ligado e o Perfil ativo; devolve o programa (cliente + país). */
  async function fanProgram(tenantId: string, profileId: string) {
    if (!(await tenantHasGamification(db(), tenantId))) throw problems.moduleNotInPlan('gamification');
    const profile = await readFan(db(), tenantId, profileId);
    if (!profile) throw problems.invalidFanToken('Perfil excluído.');
    return resolveProgram(db(), tenantId, profile.country);
  }

  async function predictableEvent(eventId: string) {
    const [row] = await db()
      .select({ sport: event.sport, startsAt: event.startsAt, status: event.status })
      .from(event)
      .where(eq(event.id, eventId));
    if (!row || !PREDICTION_SPORTS.includes(row.sport)) throw problems.notFound('Jogo com Palpite');
    return row;
  }

  app.get('/v1/predictions/open', { config: { fan: true, age: 'predict' } }, async (request, reply) => {
    const fan = request.fan!;
    const { event_id: eventId } = parseInput(PredictionOpenQuery, request.query);
    const program = await fanProgram(fan.tenantId, fan.profileId);
    const ev = await predictableEvent(eventId);
    const floors = quantityFloors(ev.sport);
    const rows = await readPredictions(db(), { ...program, profileId: fan.profileId, eventId });
    const at = now();
    reply.header('cache-control', 'no-store');
    const out: OpenPredictions = {
      data: {
        event_id: eventId,
        sport: ev.sport,
        lock_at: ev.startsAt.toISOString(),
        open: PREDICTABLE_STATUSES.has(ev.status) && at < ev.startsAt,
        kinds: Object.keys(floors).length ? ['exact_score', 'winner', 'quantity'] : ['exact_score', 'winner'],
        floors: { ...floors },
        predictions: rows.map(view),
        server_time: at.toISOString(),
      },
    };
    return out;
  });

  app.put('/v1/predictions/:eventId', { config: { fan: true, age: 'predict' } }, async (request, reply) => {
    const fan = request.fan!;
    const { eventId } = parseInput(PredictionEventParams, request.params);
    const body = parseInput(PredictionsBody, request.body);
    const program = await fanProgram(fan.tenantId, fan.profileId);
    const ev = await predictableEvent(eventId);
    if (!PREDICTABLE_STATUSES.has(ev.status))
      throw problems.conflict('O prazo do Palpite acabou: o jogo já começou.');

    const floors = quantityFloors(ev.sport);
    const seen = new Set<string>();
    const errors: { path: string; message: string }[] = [];
    body.predictions.forEach((p, i) => {
      const value = toRules(p);
      const key = `${p.kind}:${predictionSubject(value)}`;
      if (seen.has(key))
        errors.push({ path: `predictions.${i}`, message: 'Palpite repetido no mesmo pedido.' });
      seen.add(key);
      const rejection = validatePrediction(value, { now: now(), lockAt: ev.startsAt, floors });
      if (rejection === 'locked') return;
      if (rejection === 'below_floor')
        errors.push({
          path: `predictions.${i}.atLeast`,
          message: `Abaixo do Piso (${floors[predictionSubject(value)]}).`,
        });
      else if (rejection === 'unknown_subject')
        errors.push({
          path: `predictions.${i}.subject`,
          message: 'Assunto sem Palpite de quantidade neste esporte.',
        });
      else if (rejection === 'invalid_value')
        errors.push({ path: `predictions.${i}`, message: 'Palpite inválido.' });
    });
    if (errors.length) throw problems.invalidParams(errors);

    const saved = await savePredictions(db(), {
      ...program,
      profileId: fan.profileId,
      eventId,
      lockAt: ev.startsAt,
      items: body.predictions.map((p) => ({
        kind: p.kind,
        subject: predictionSubject(toRules(p)),
        value: p as Record<string, unknown>,
      })),
    });
    if (!saved.ok) throw problems.conflict('O prazo do Palpite acabou: o jogo já começou.');
    reply.header('cache-control', 'no-store');
    const out: SavedPredictions = { data: { event_id: eventId, predictions: saved.rows.map(view) } };
    return out;
  });

  app.get('/v1/rankings/:period', { config: { fan: true, age: 'read' } }, async (request, reply) => {
    const fan = request.fan!;
    const params = parseInput(RankingParams, request.params);
    const { limit } = parseInput(RankingQuery, request.query);
    const program = await fanProgram(fan.tenantId, fan.profileId);
    const period = resolveRankingPeriod(params.period, program.timeZone, now());
    const rows = await readRanking(db(), { ...program, period, limit });
    reply.header('cache-control', 'private, max-age=30');
    const out: Ranking = {
      data: {
        period,
        program_country: program.programCountry,
        entries: rows.map((r) => ({
          position: r.position,
          profile_id: r.profileId,
          nickname: r.nickname,
          points: r.points,
          full_hits: r.fullHits,
          is_me: r.profileId === fan.profileId,
        })),
      },
    };
    return out;
  });

  app.get('/v1/rankings/:period/me', { config: { fan: true, age: 'read' } }, async (request, reply) => {
    const fan = request.fan!;
    const params = parseInput(RankingParams, request.params);
    const program = await fanProgram(fan.tenantId, fan.profileId);
    const period = resolveRankingPeriod(params.period, program.timeZone, now());
    const me = await readMyRanking(db(), { ...program, period, profileId: fan.profileId });
    reply.header('cache-control', 'no-store');
    const out: MyRanking = {
      data: {
        period,
        program_country: program.programCountry,
        position: me.position,
        points: me.points,
        full_hits: me.fullHits,
      },
    };
    return out;
  });

  app.get('/v1/fans/me/achievements', { config: { fan: true, age: 'read' } }, async (request, reply) => {
    const fan = request.fan!;
    const program = await fanProgram(fan.tenantId, fan.profileId);
    const [rows, active] = await Promise.all([
      readFanAchievements(db(), { ...program, profileId: fan.profileId }),
      activeAchievements(db(), program),
    ]);
    reply.header('cache-control', 'no-store');
    const out: FanAchievements = {
      data: { program_country: program.programCountry, achievements: achievementsView(rows, active) },
    };
    return out;
  });

  app.get('/v1/fans/me/cards', { config: { fan: true, age: 'read' } }, async (request, reply) => {
    const fan = request.fan!;
    const program = await fanProgram(fan.tenantId, fan.profileId);
    const cards = await readFanCards(db(), { ...program, profileId: fan.profileId });
    reply.header('cache-control', 'no-store');
    const out: FanCards = { data: { program_country: program.programCountry, cards: cardsView(cards) } };
    return out;
  });

  // ─── servidor do cliente (chave secreta) ───

  app.get(
    '/v1/fans/:externalAccountId/profiles/:externalProfileId/game',
    { config: { authenticated: true } },
    async (request, reply) => {
      const tenantId = secretTenantId(request);
      const params = parseInput(GameFanParams, request.params);
      const fan = await findFanByExternal(db(), { tenantId, ...params });
      if (!fan) throw problems.notFound('Perfil');
      // menor de 13 fica fora da Gamificação, também na leitura pelo servidor
      if (fan.ageBand === 'under13') throw problems.fanAgeRestricted('Perfil abaixo de 13 anos.');
      const program = await resolveProgram(db(), tenantId, fan.country);
      const key = { ...program, profileId: fan.profileId };
      const [rows, active, cards, wallets] = await Promise.all([
        readFanAchievements(db(), key),
        activeAchievements(db(), program),
        readFanCards(db(), key),
        readWallets(db(), tenantId, fan.profileId),
      ]);
      const wallet = wallets.find((w) => w.programCountry === program.programCountry);
      const level = await levelForPoints(
        db(),
        Math.max(wallet?.points ?? 0, await peakPoints(db(), { ...program, profileId: fan.profileId })),
      );
      reply.header('cache-control', 'no-store');
      const out: FanGameSummary = {
        data: {
          profile_id: fan.profileId,
          program_country: program.programCountry,
          points: wallet?.points ?? 0,
          balance: wallet?.balance ?? 0,
          level: { level: level.level, min_points: level.minPoints, next_min_points: level.nextMinPoints },
          achievements: achievementsView(rows, active),
          cards: cardsView(cards),
        },
      };
      return out;
    },
  );

  app.get('/v1/game/rankings/:period', { config: { authenticated: true } }, async (request, reply) => {
    const tenantId = secretTenantId(request);
    const params = parseInput(RankingParams, request.params);
    const { limit, country } = parseInput(GameRankingServerQuery, request.query);
    const period = resolveRankingPeriod(params.period, countryTimeZone(country), now());
    // só os países em que o cliente opera (o programa de outro país não existe para ele)
    if ((await programCountryFor(db(), tenantId, country)) !== country)
      throw problems.notFound('Programa no país');
    const rows = await readRanking(db(), { tenantId, programCountry: country, period, limit });
    reply.header('cache-control', 'private, max-age=30');
    const out: Ranking = {
      data: {
        period,
        program_country: country,
        entries: rows.map((r) => ({
          position: r.position,
          profile_id: r.profileId,
          nickname: r.nickname,
          points: r.points,
          full_hits: r.fullHits,
        })),
      },
    };
    return out;
  });

  app.get('/v1/achievements', { config: { fan: true, age: 'read' } }, async (request, reply) => {
    const fan = request.fan!;
    const { sport } = parseInput(AchievementCatalogQuery, request.query);
    const program = await fanProgram(fan.tenantId, fan.profileId);
    const rows = await readProgramCatalog(db(), { ...program, sport });
    reply.header('cache-control', 'private, max-age=300');
    const out: AchievementCatalog = {
      data: {
        program_country: program.programCountry,
        achievements: rows.map((a) => ({
          id: a.id,
          sport: a.sport,
          category: a.category as AchievementCatalog['data']['achievements'][number]['category'],
          family: a.family,
          stepped: a.stepped,
          seasonal: a.seasonal,
          name: a.name,
          description: a.description,
          steps: a.steps.map((s) => ({ step: s.step, threshold: s.threshold, card_key: s.cardKey })),
        })),
      },
    };
    return out;
  });

  app.get(
    '/v1/achievements/:achievementId/earners',
    { config: { fan: true, age: 'read' } },
    async (request, reply) => {
      const fan = request.fan!;
      const { achievementId } = parseInput(AchievementEarnersParams, request.params);
      const { season, limit } = parseInput(AchievementEarnersQuery, request.query);
      const program = await fanProgram(fan.tenantId, fan.profileId);
      const res = await readAchievementEarners(db(), { ...program, achievementId, season, limit });
      reply.header('cache-control', 'private, max-age=60');
      const out: AchievementEarners = {
        data: {
          achievement_id: achievementId,
          season,
          total: res.total,
          earners: res.earners.map((e) => ({
            profile_id: e.profileId,
            nickname: e.nickname,
            avatar_url: e.avatarUrl,
            step: e.step,
            is_me: e.profileId === fan.profileId,
          })),
        },
      };
      return out;
    },
  );
}
