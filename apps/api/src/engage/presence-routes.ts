/**
 * Presença ao vivo verificada (#906, B9, docs/05 §9), com o token `gft_` do torcedor:
 *
 * - `POST /v1/fans/me/presence`: o sinal que o widget (ou o app do cliente) manda a cada 30 s enquanto o jogo está
 *   visível. O servidor grava a janela pelo relógio do banco; o do aparelho nunca vale.
 * - `GET /v1/events/{eventId}/presence`: quantos torcedores do cliente estão no jogo agora (para a sala do chat).
 *
 * As regras vêm de `@galaxie/engage` (`presence.ts`); as janelas, de `@galaxie/db`; a contagem fica no Valkey.
 */
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import {
  FanPresenceBody,
  PresenceEventParams,
  type EventPresence,
  type FanPresenceResponse,
} from '@galaxie/contracts';
import {
  event,
  purgePresence,
  readPresenceLimit,
  readRuntimeOverrides,
  recordHeartbeat,
  type Database,
} from '@galaxie/db';
import {
  PRESENCE_GAP_S,
  PRESENCE_HEARTBEAT_S,
  PRESENCE_MAX_GAMES_DEFAULT,
  PRESENCE_RETENTION_DAYS,
  heartbeatVerdict,
  interactionDue,
  presenceMaxGames,
} from '@galaxie/engage';
import { resolveSetting, settingDef } from '@galaxie/runtime-config';
import { eq } from 'drizzle-orm';
import { problems } from '../errors.js';
import { parseInput } from '../util.js';
import { fanCan } from './fan-rules.js';
import { readFan } from './fans.js';

/** Jogo em que a presença conta: começando, rolando ou no intervalo. */
const LIVE_STATUSES = new Set(['starting', 'live', 'break']);

/** Quem está em cada jogo agora, por cliente. */
export interface PresenceCounter {
  /** Marca o Perfil no jogo e devolve quantos estão lá (sinal nos últimos `PRESENCE_GAP_S`). */
  touch(tenantId: string, eventId: string, profileId: string, atMs: number): Promise<number>;
  count(tenantId: string, eventId: string, atMs: number): Promise<number>;
}

export class RedisPresenceCounter implements PresenceCounter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}
  private key(tenantId: string, eventId: string) {
    return `${this.prefix}presence:${tenantId}:${eventId}`;
  }
  async touch(tenantId: string, eventId: string, profileId: string, atMs: number): Promise<number> {
    const key = this.key(tenantId, eventId);
    const res = await this.redis
      .multi()
      .zadd(key, atMs, profileId)
      .zremrangebyscore(key, '-inf', atMs - PRESENCE_GAP_S * 1000)
      .zcard(key)
      .expire(key, PRESENCE_GAP_S * 2)
      .exec();
    return Number(res?.[2]?.[1] ?? 0);
  }
  async count(tenantId: string, eventId: string, atMs: number): Promise<number> {
    return this.redis.zcount(this.key(tenantId, eventId), atMs - PRESENCE_GAP_S * 1000, '+inf');
  }
}

export class MemoryPresenceCounter implements PresenceCounter {
  private readonly rooms = new Map<string, Map<string, number>>();
  private room(tenantId: string, eventId: string, atMs: number) {
    const key = `${tenantId}:${eventId}`;
    let r = this.rooms.get(key);
    if (!r) {
      if (this.rooms.size > 10_000) this.rooms.clear();
      r = new Map();
      this.rooms.set(key, r);
    }
    for (const [p, t] of r) if (t <= atMs - PRESENCE_GAP_S * 1000) r.delete(p);
    return r;
  }
  async touch(tenantId: string, eventId: string, profileId: string, atMs: number): Promise<number> {
    const r = this.room(tenantId, eventId, atMs);
    r.set(profileId, atMs);
    return r.size;
  }
  async count(tenantId: string, eventId: string, atMs: number): Promise<number> {
    return this.room(tenantId, eventId, atMs).size;
  }
}

/** FAN_PRESENCE_MAX_GAMES (painel > env > 3), relido no máximo a cada minuto. */
export class PresenceMaxGames {
  private value = PRESENCE_MAX_GAMES_DEFAULT;
  private readAt = 0;
  constructor(
    private readonly db: Database | undefined,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly now: () => number = Date.now,
  ) {}

  async galaxie(): Promise<number> {
    if (this.now() - this.readAt < 60_000) return this.value;
    this.readAt = this.now();
    try {
      const def = settingDef('FAN_PRESENCE_MAX_GAMES')!;
      const overrides = this.db ? await readRuntimeOverrides(this.db) : new Map<string, string>();
      const n = Number(resolveSetting(def, { overrides, env: (k) => this.env[k] }).value);
      if (Number.isInteger(n) && n >= 1 && n <= 10) this.value = n;
    } catch {
      // painel indisponível: segue com o último valor lido
    }
    return this.value;
  }
}

/** Retenção das janelas (`PRESENCE_RETENTION_DAYS`): de hora em hora, no processo da API, que já escreve em `fan`. */
export function startPresencePurge(
  db: Database,
  log: { warn: (obj: object, msg: string) => void },
  everyMs = 3_600_000,
): () => void {
  const run = () => {
    purgePresence(db, new Date(Date.now() - PRESENCE_RETENTION_DAYS * 86_400_000)).catch((err: unknown) =>
      log.warn({ err }, 'expurgo da presença falhou'),
    );
  };
  // a primeira rodada sai poucos minutos depois de subir (com deploys seguidos, o intervalo sozinho nunca chegaria)
  const first = setTimeout(run, Math.floor(60_000 + Math.random() * 240_000));
  first.unref();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

export interface PresenceRoutesDeps {
  db: Database | undefined;
  counter: PresenceCounter;
  maxGames: PresenceMaxGames;
}

export async function presenceRoutes(app: FastifyInstance, deps: PresenceRoutesDeps): Promise<void> {
  const db = () => {
    if (!deps.db) throw problems.degraded('Banco de dados não configurado.');
    return deps.db;
  };

  /** O jogo existe e está ao vivo? */
  async function liveEvent(eventId: string): Promise<void> {
    const [row] = await db().select({ status: event.status }).from(event).where(eq(event.id, eventId));
    if (!row) throw problems.notFound('Jogo');
    if (!LIVE_STATUSES.has(row.status))
      throw problems.conflict('A presença só conta com o jogo ao vivo (começando, rolando ou no intervalo).');
  }

  app.post('/v1/fans/me/presence', { config: { fan: true } }, async (request, reply) => {
    const fan = request.fan!;
    if (!fanCan(fan.ageBand, 'read'))
      throw problems.fanAgeRestricted('Perfis com menos de 13 anos não usam os recursos sociais.');
    const body = parseInput(FanPresenceBody, request.body);
    const profile = await readFan(db(), fan.tenantId, fan.profileId);
    if (!profile) throw problems.invalidFanToken('Perfil excluído.');
    await liveEvent(body.eventId);
    const maxGames = presenceMaxGames(
      await deps.maxGames.galaxie(),
      await readPresenceLimit(db(), fan.tenantId),
    );
    const res = await recordHeartbeat(db(), {
      tenantId: fan.tenantId,
      profileId: fan.profileId,
      eventId: body.eventId,
      visible: body.visible,
      interacted: body.interacted ?? false,
      rules: { gapMs: PRESENCE_GAP_S * 1000, maxGames, verdict: heartbeatVerdict },
    });
    const at = res.at.getTime();
    let present: number;
    try {
      present = res.counted
        ? await deps.counter.touch(fan.tenantId, body.eventId, fan.profileId, at)
        : await deps.counter.count(fan.tenantId, body.eventId, at);
    } catch (err) {
      // Valkey fora: a janela já está gravada; só a contagem da sala fica de fora
      request.log.warn({ err }, 'contagem de presença indisponível');
      present = 0;
    }
    reply.header('cache-control', 'no-store');
    const out: FanPresenceResponse = {
      data: {
        counted: res.counted,
        reason: res.counted ? null : res.reason,
        interaction_due: res.counted
          ? interactionDue(res.lastInteractionAt.getTime(), at)
          : res.reason === 'interaction_needed',
        heartbeat_s: PRESENCE_HEARTBEAT_S,
        present,
        server_time: res.at.toISOString(),
      },
    };
    return out;
  });

  app.get('/v1/events/:eventId/presence', { config: { fan: true } }, async (request, reply) => {
    const fan = request.fan!;
    if (!fanCan(fan.ageBand, 'read'))
      throw problems.fanAgeRestricted('Perfis com menos de 13 anos não usam os recursos sociais.');
    const { eventId } = parseInput(PresenceEventParams, request.params);
    let present = 0;
    try {
      present = await deps.counter.count(fan.tenantId, eventId, Date.now());
    } catch (err) {
      request.log.warn({ err }, 'contagem de presença indisponível');
    }
    reply.header('cache-control', 'no-store');
    const out: EventPresence = { data: { event_id: eventId, present } };
    return out;
  });
}
