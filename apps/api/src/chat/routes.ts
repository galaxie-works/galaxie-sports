/**
 * Rotas do Chat ao vivo (Sala do Jogo, #915, #959):
 *
 * - `GET /v1/chat/rooms/{jogo}`: estado da sala e últimas mensagens. Chave do cliente (publicável no navegador), sem
 *   login: ler é livre;
 * - `PATCH /v1/chat/rooms/{jogo}`: o servidor do cliente congela, reabre ou ajusta a sala (chave secreta);
 * - `POST /v1/chat/rooms/{jogo}/messages`: o torcedor `18plus` envia, com o token `gft_`;
 * - `GET` e `PUT /v1/chat/config`: o padrão do cliente para as salas (chave secreta).
 *
 * Tudo exige o módulo `live_chat`. As regras (janela, quem envia) ficam em `@galaxie/engage`; o filtro de texto é a
 * base de moderação (#969), que nunca desliga.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ChatConfigBody,
  ChatMessageBody,
  ChatReactionBody,
  ChatRoomParams,
  ChatRoomPatchBody,
  type ChatConfig,
  type ChatMessageResponse,
  type ChatReactionResponse,
  type ChatRoom,
} from '@galaxie/contracts';
import {
  activeSanctions,
  CHAT_GAME_KINDS,
  holdContent,
  type ChatStrictness,
  type Database,
} from '@galaxie/db';
import {
  canReadRoom,
  gameKindEnabled,
  linkHosts,
  roomWindow,
  screen,
  screenNotice,
  sendRefusal,
  sendRefusalNotice,
  type ChatRoomState,
} from '@galaxie/engage';
import type { TenantContext } from '../auth/authenticator.js';
import { ProblemError, problems } from '../errors.js';
import { parseInput } from '../util.js';
import { publicAvatars } from '../engage/fan-avatar.js';
import { readFan } from '../engage/fans.js';
import { clocksFor } from '../engage/moderation-routes.js';
import { ModerationLists } from '../engage/moderation.js';
import {
  ensureRoom,
  insertMessage,
  lastSentAt,
  patchRoom,
  readRoom,
  readChatEvent,
  readTenantConfig,
  pinnedMessage,
  recentMessages,
  tenantHasLiveChat,
  writeTenantConfig,
  type ChatMessageRow,
  type ChatRoomRow,
  type ChatTenantConfigRow,
} from './rooms.js';
import { ChatSettings, type ChatSettingsValues } from './settings.js';
import { ChatHub, reactionRoomKey } from './hub.js';
import { MemoryFloodGuard, type FloodGuard } from './flood.js';
import { BOT_BLOCK_MS, botLinks, MemoryBotGuard, type BotGuard } from './bot.js';
import { MemoryReactionCounter, type ReactionCounter } from './reactions.js';
import { gameMessages } from './game.js';
import { MemoryChatPeak, type ChatPeak } from './peak.js';
import { registerChatStream, type ChatStreamOptions } from './stream.js';

export interface ChatRoutesDeps {
  db: Database | undefined;
  settings?: ChatSettings | undefined;
  now?: (() => Date) | undefined;
  /** Lotes da sala (#964); sem ele, um hub local à instância. */
  hub?: ChatHub | undefined;
  /** Faixa de conexões e pico (D6); sem ele, em memória. */
  peak?: ChatPeak | undefined;
  stream?: ChatStreamOptions | undefined;
  /** Contador das reações (#967); sem ele, em memória. */
  reactions?: ReactionCounter | undefined;
  /** Fecha o segundo das reações a cada `ms`. Padrão 1 s. */
  reactionsIntervalMs?: number | undefined;
  /** Anti-flood por pessoa; sem ele, em memória. */
  flood?: FloodGuard | undefined;
  /** Detecção de robô (#1290); sem ela, em memória. */
  bot?: BotGuard | undefined;
}

const MODULE = { module: 'live_chat' as const };

/** Valores efetivos da sala: a sala, senão o cliente, senão a Galaxie. */
function effective(room: ChatRoomRow | null, cfg: ChatTenantConfigRow, g: ChatSettingsValues) {
  return {
    openBeforeMinutes: cfg.openBeforeMinutes ?? g.openBeforeMinutes,
    closeAfterMinutes: cfg.closeAfterMinutes ?? g.closeAfterMinutes,
    slowModeSeconds: room?.slowModeSeconds ?? cfg.slowModeSeconds ?? g.slowModeSeconds,
    strictness: (room?.strictness ?? cfg.strictness ?? 'standard') as ChatStrictness,
    maxChars: g.maxChars,
    historyOnJoin: g.historyOnJoin,
    eventKinds: cfg.eventKinds,
    flood: {
      maxPerMinute: cfg.floodMaxPerMinute ?? g.floodMaxPerMinute,
      blockSeconds: cfg.floodBlockSeconds ?? g.floodBlockSeconds,
    },
  };
}

function messageView(
  m: Pick<
    ChatMessageRow,
    'id' | 'body' | 'profileId' | 'nickname' | 'avatarUrl' | 'avatarVisibility' | 'createdAt'
  >,
) {
  return {
    id: m.id,
    body: m.body,
    author: {
      profile_id: m.profileId,
      nickname: m.nickname,
      avatar_url: m.avatarVisibility === 'private' ? null : m.avatarUrl,
    },
    created_at: m.createdAt.toISOString(),
  };
}

/** Chave secreta (servidor do cliente). */
function secretTenant(request: FastifyRequest): TenantContext {
  const t = request.tenant!;
  if (t.keyKind !== 'secret' || !t.keyPrefix)
    throw problems.invalidKey('Use a chave secreta no header x-galaxie-key, no seu servidor.');
  return t;
}

export async function chatRoutes(app: FastifyInstance, deps: ChatRoutesDeps): Promise<void> {
  const settings = deps.settings ?? new ChatSettings(deps.db);
  const moderation = deps.db ? new ModerationLists(deps.db) : null;
  const now = () => deps.now?.() ?? new Date();
  const hub = deps.hub ?? new ChatHub();
  const reactions = deps.reactions ?? new MemoryReactionCounter();
  const flood = deps.flood ?? new MemoryFloodGuard();
  let floodErrorAt = 0;
  const bot = deps.bot ?? new MemoryBotGuard();
  let botErrorAt = 0;
  // Fecha o segundo das reações. Toda instância roda o relógio, mas só uma fecha cada segundo (trava no Valkey) e o
  // script atômico garante que cada reação conta uma vez. Uma rodada por vez; o log de falha sai no máximo por minuto
  let flushing = false;
  let reactionErrorAt = 0;
  const reactionTimer = setInterval(() => {
    if (flushing) return;
    flushing = true;
    reactions
      .flush()
      .then((list) =>
        Promise.all(
          list.map((f) => {
            const [tenantId, fixtureId] = f.room.split(':') as [string, string];
            return hub.broadcast(reactionRoomKey(tenantId, fixtureId), f.tally);
          }),
        ),
      )
      .catch((err: unknown) => {
        if (Date.now() - reactionErrorAt < 60_000) return;
        reactionErrorAt = Date.now();
        app.log.warn({ err }, 'chat: reações indisponíveis');
      })
      .finally(() => {
        flushing = false;
      });
  }, deps.reactionsIntervalMs ?? 1_000);
  reactionTimer.unref();
  app.addHook('onClose', async () => clearInterval(reactionTimer));
  const peak = deps.peak ?? new MemoryChatPeak(() => now().getTime());
  if (!deps.hub) {
    app.addHook('onReady', () => hub.start());
    app.addHook('onClose', () => hub.stop());
  }
  const db = () => {
    if (!deps.db) throw problems.degraded('Banco de dados não configurado.');
    return deps.db;
  };

  // relógio de conteúdo da ficha por cliente e país, guardado por 60 s (a ficha muda pouco; o envio é o caminho quente)
  const purgeOffsets = new Map<string, { at: number; ms: number }>();
  async function purgeAtFor(tenantId: string, country: string, at: Date): Promise<Date> {
    const key = `${tenantId}:${country}`;
    const hit = purgeOffsets.get(key);
    if (hit && at.getTime() - hit.at < 60_000) return new Date(at.getTime() + hit.ms);
    const clocks = await clocksFor(db(), tenantId, country, new Date(0));
    if (purgeOffsets.size > 10_000) purgeOffsets.clear();
    purgeOffsets.set(key, { at: at.getTime(), ms: clocks.contentPurgeAt.getTime() });
    return new Date(at.getTime() + clocks.contentPurgeAt.getTime());
  }

  /**
   * Robô travado (#1290): o caso vai para a fila humana, que decide (o validador sinaliza). Alvo próprio
   * (`behavior`, `chat_bot:<perfil>`): não se mistura com o caso aberto do Perfil por outro motivo (foto, faixa).
   */
  async function holdBotCase(
    tenantId: string,
    roomId: string,
    profileId: string,
    country: string,
    signals: readonly string[],
    text: string,
    at: Date,
  ): Promise<void> {
    await holdContent(db(), {
      tenantId,
      targetType: 'behavior',
      targetId: `chat_bot:${profileId}`,
      targetProfileId: profileId,
      module: 'chat',
      room: roomId,
      community: null,
      source: 'filter',
      reasons: [...signals],
      severity: 50,
      hide: false,
      content: text,
      detail: { signals, blocked_minutes: BOT_BLOCK_MS / 60_000 },
      clocks: await clocksFor(db(), tenantId, country, at),
      now: at,
    });
  }

  /**
   * Sala do jogo com a janela calculada. `create = false` (leitura, aberta à chave publicável) não grava nada: sem
   * sala ainda, responde a sala como ela nasceria. Só o envio e o ajuste do cliente criam a linha.
   */
  async function loadRoom(tenantId: string, fixtureId: string, create = true) {
    const database = db();
    const ev = await readChatEvent(database, fixtureId);
    if (!ev) throw problems.notFound('Jogo');
    const [room, cfg, g] = await Promise.all([
      create ? ensureRoom(database, tenantId, fixtureId) : readRoom(database, tenantId, fixtureId),
      readTenantConfig(database, tenantId),
      settings.get(),
    ]);
    const eff = effective(room, cfg, g);
    const window = roomWindow({
      storedState: room?.state ?? 'open',
      event: {
        startsAt: ev.startsAt.getTime(),
        endsAtExpected: ev.endsAtExpected.getTime(),
        status: ev.status,
        updatedAt: ev.updatedAt.getTime(),
      },
      openBeforeMinutes: eff.openBeforeMinutes,
      closeAfterMinutes: eff.closeAfterMinutes,
      now: now().getTime(),
    });
    return { room, eff, window };
  }

  async function roomBody(
    tenantId: string,
    fixtureId: string,
    loaded: Awaited<ReturnType<typeof loadRoom>>,
  ): Promise<ChatRoom> {
    const { room, eff, window } = loaded;
    const visible: ChatRoomState[] = ['open', 'frozen', 'read_only_peak', 'closed'];
    const show = room !== null && visible.includes(window.state);
    const [messages, game, pinned] = await Promise.all([
      show ? recentMessages(db(), tenantId, room.id, eff.historyOnJoin) : Promise.resolve([]),
      gameMessages(db(), fixtureId),
      show && room.pinnedMessageId
        ? pinnedMessage(db(), tenantId, room.id, room.pinnedMessageId)
        : Promise.resolve(null),
    ]);
    return {
      data: {
        room_id: room?.id ?? null,
        fixture_id: fixtureId,
        state: window.state,
        opens_at: new Date(window.opensAt).toISOString(),
        closes_at: new Date(window.closesAt).toISOString(),
        settings: {
          slow_mode_seconds: eff.slowModeSeconds,
          strictness: eff.strictness,
          max_chars: eff.maxChars,
        },
        messages: messages.map(messageView),
        pinned: pinned ? messageView(pinned) : null,
        game_messages: game.filter((m) => gameKindEnabled(eff.eventKinds, m.kind)),
        reactions: await reactions.totals(`${tenantId}:${fixtureId}`).catch(() => ({})),
      },
    };
  }

  app.get('/v1/chat/rooms/:fixtureId', { config: MODULE }, async (request, reply) => {
    const { fixtureId } = parseInput(ChatRoomParams, request.params);
    const tenantId = request.tenant!.tenantId;
    const loaded = await loadRoom(tenantId, fixtureId, false);
    // mensagens do chat fora dos buscadores e de caches compartilhados (regra 10 do épico)
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow');
    return roomBody(tenantId, fixtureId, loaded);
  });

  app.patch('/v1/chat/rooms/:fixtureId', { config: MODULE }, async (request, reply) => {
    const tenant = secretTenant(request);
    const { fixtureId } = parseInput(ChatRoomParams, request.params);
    const body = parseInput(ChatRoomPatchBody, request.body);
    const before = await loadRoom(tenant.tenantId, fixtureId);
    // o cliente não sai do só leitura por pico (limite do plano, D6) nem reabre o que a Galaxie congelou
    const room = before.room!;
    if (
      body.state !== undefined &&
      (room.state === 'read_only_peak' || (room.state === 'frozen' && room.stateBy?.startsWith('galaxie:')))
    )
      throw problems.conflict(
        room.state === 'read_only_peak'
          ? 'A sala está só leitura pelo pico do plano; ela volta sozinha quando as conexões baixarem.'
          : 'A sala foi congelada pela equipe da Galaxie.',
      );
    await patchRoom(db(), tenant.tenantId, room.id, body, `tenant:${tenant.keyPrefix}`);
    const after = await loadRoom(tenant.tenantId, fixtureId);
    reply.header('cache-control', 'no-store');
    return roomBody(tenant.tenantId, fixtureId, after);
  });

  // Módulo e estado da sala para a reação, guardados por 5 s por cliente e jogo (num gol, milhares de reações por
  // segundo na mesma sala não podem virar milhares de consultas no banco)
  const reactionGates = new Map<
    string,
    { at: number; value: Promise<{ liveChat: boolean; state: ChatRoomState }> }
  >();
  function reactionGate(tenantId: string, fixtureId: string) {
    const key = `${tenantId}:${fixtureId}`;
    const hit = reactionGates.get(key);
    if (hit && Date.now() - hit.at < 5_000) return hit.value;
    const value = (async () => {
      const liveChat = await tenantHasLiveChat(db(), tenantId);
      if (!liveChat) return { liveChat, state: 'closed' as ChatRoomState };
      return { liveChat, state: (await loadRoom(tenantId, fixtureId, false)).window.state };
    })();
    value.catch(() => reactionGates.delete(key));
    if (reactionGates.size > 10_000) reactionGates.clear();
    reactionGates.set(key, { at: Date.now(), value });
    return value;
  }

  // Banimento ou suspensão do torcedor no cliente, guardado por 10 s (a reação é o caminho quente; a punição nova vale
  // em até 10 s). Banco fora: não barra (a reação não é texto)
  const bans = new Map<string, { at: number; value: Promise<boolean> }>();
  function reactionBanned(tenantId: string, profileId: string, accountId: string): Promise<boolean> {
    const key = `${tenantId}:${profileId}`;
    const hit = bans.get(key);
    if (hit && Date.now() - hit.at < 10_000) return hit.value;
    const value = activeSanctions(db(), { tenantId, profileId, accountId, now: now() })
      .then((list) =>
        list.some((x) => x.scope === 'tenant' && (x.level === 'ban' || x.level === 'suspension')),
      )
      .catch(() => false);
    if (bans.size > 100_000) bans.clear();
    bans.set(key, { at: Date.now(), value });
    return value;
  }

  // Reação (#967): não é texto, então quem tem 13 a 17 também reage (`age: 'react'`; o portão de idade decide pela
  // ficha do país). Passou do limite por segundo: 202 com `accepted: false`, sem erro (o widget só não soma)
  app.post(
    '/v1/chat/rooms/:fixtureId/reactions',
    // balde próprio (fora dos 120/min do torcedor): tocar 🔥 num gol não pode travar o envio de mensagem
    { config: { fan: true, age: 'react', fanBucket: { name: 'react', perMinute: 600 } } },
    async (request, reply) => {
      const fan = request.fan!;
      const { fixtureId } = parseInput(ChatRoomParams, request.params);
      const body = parseInput(ChatReactionBody, request.body);
      const { liveChat, state } = await reactionGate(fan.tenantId, fixtureId);
      if (!liveChat) throw problems.moduleNotInPlan('live_chat');
      const window = { state };
      if (window.state === 'scheduled' || window.state === 'closed')
        throw new ProblemError(
          409,
          'CONFLICT',
          'Sala fechada para reações',
          sendRefusalNotice(window.state === 'closed' ? 'room_closed' : 'room_scheduled', fan.locale),
          {
            errors: [
              { path: 'refusal', message: window.state === 'closed' ? 'room_closed' : 'room_scheduled' },
            ],
          },
        );
      // banimento e suspensão no cliente também barram a reação (decisão de 15/11); sala congelada segue aceitando
      if (await reactionBanned(fan.tenantId, fan.profileId, fan.accountId))
        throw new ProblemError(
          409,
          'CONFLICT',
          'Reação bloqueada por punição',
          'Você não pode reagir agora. Veja suas punições no seu Perfil.',
          { errors: [{ path: 'refusal', message: 'sanctioned' }] },
        );
      const accepted = await reactions
        .add(`${fan.tenantId}:${fixtureId}`, fan.profileId, body.reaction)
        .catch((err: unknown) => {
          request.log.warn({ err }, 'chat: contador de reações indisponível');
          return false;
        });
      reply.header('cache-control', 'no-store');
      const res: ChatReactionResponse = { data: { accepted } };
      return reply.code(202).send(res);
    },
  );

  app.post(
    '/v1/chat/rooms/:fixtureId/messages',
    { config: { fan: true, age: 'write' } },
    async (request, reply) => {
      const fan = request.fan!;
      const { fixtureId } = parseInput(ChatRoomParams, request.params);
      const body = parseInput(ChatMessageBody, request.body);
      const database = db();
      if (!(await tenantHasLiveChat(database, fan.tenantId))) throw problems.moduleNotInPlan('live_chat');
      if (!canReadRoom(fan.ageBand))
        throw problems.fanAgeRestricted('Perfis com menos de 13 anos não usam os recursos sociais.');
      // o portão (config.age 'write') já conferiu a ficha do país; a faixa larga fica como segunda trava
      if (fan.ageBand !== '18plus')
        throw problems.fanAgeRestricted(sendRefusalNotice('age_band', fan.locale));

      const loaded = await loadRoom(fan.tenantId, fixtureId);
      const room = loaded.room!;
      const { eff, window } = loaded;
      const refusal = sendRefusal(window.state, fan.ageBand);
      if (refusal)
        throw new ProblemError(
          409,
          'CONFLICT',
          'Sala fechada para envio',
          sendRefusalNotice(refusal, fan.locale),
          {
            errors: [{ path: 'refusal', message: refusal }],
          },
        );

      // pico da faixa (D6): quem já estava escrevendo continua; quem chegou depois lê
      const peakFailOpen = (err: unknown) => {
        request.log.warn({ err }, 'chat: pico indisponível');
        return false;
      };
      if (
        (await peak.inPeak(fan.tenantId).catch(peakFailOpen)) &&
        !(await peak.hasSeat(fan.tenantId, fan.profileId).catch(() => true))
      )
        throw new ProblemError(
          409,
          'CONFLICT',
          'Sala fechada para envio',
          sendRefusalNotice('room_read_only_peak', fan.locale),
          { errors: [{ path: 'refusal', message: 'room_read_only_peak' }] },
        );

      const at = now();
      const [profile, sanctions, last, lists] = await Promise.all([
        readFan(database, fan.tenantId, fan.profileId),
        activeSanctions(database, {
          tenantId: fan.tenantId,
          profileId: fan.profileId,
          accountId: fan.accountId,
          now: at,
        }),
        eff.slowModeSeconds > 0
          ? lastSentAt(database, fan.tenantId, room.id, fan.profileId)
          : Promise.resolve(null),
        moderation!.forTenant(fan.tenantId),
      ]);
      if (!profile) throw problems.invalidFanToken('Perfil excluído.');
      // a faixa do banco vale sobre a do token (mudou depois de o token sair)
      if (profile.ageBand !== '18plus')
        throw problems.fanAgeRestricted(sendRefusalNotice('age_band', fan.locale));

      // Suspensão e Banimento valem em todas as salas do cliente; Silenciar, só onde aconteceu (a sala é o id da
      // sala ou o do jogo, que o painel do cliente usa, #973). O Silêncio oculto não
      // recusa: a mensagem fica só para o autor (ele não é avisado, é a exceção ao aviso)
      const here = (s: { scope: string; scopeId: string | null }) =>
        s.scope === 'tenant' || (s.scope === 'place' && (s.scopeId === room.id || s.scopeId === fixtureId));
      const blocking = sanctions.find(
        (s) =>
          here(s) && (s.level === 'suspension' || s.level === 'ban' || (s.level === 'mute' && !s.hidden)),
      );
      if (blocking)
        throw new ProblemError(
          409,
          'CONFLICT',
          'Envio bloqueado por punição',
          'Você não pode enviar mensagens agora. Veja suas punições no seu Perfil.',
          {
            errors: [{ path: 'refusal', message: 'sanctioned' }],
          },
        );
      const shadowMuted = sanctions.some((s) => here(s) && s.level === 'mute' && s.hidden);

      const text = body.body.trim();
      if ([...text].length > eff.maxChars)
        throw problems.invalidParams(
          [{ path: 'body', message: `até ${eff.maxChars} caracteres` }],
          'Mensagem longa demais.',
        );
      const screened = screen(
        text,
        {
          kind: 'chat_message',
          locale: fan.locale,
          rate: { intervalS: eff.slowModeSeconds, lastSentAt: last?.getTime() ?? null, now: at.getTime() },
        },
        lists,
      );
      if (screened.reasons.includes('slow_mode'))
        throw new ProblemError(
          429,
          'RATE_LIMITED',
          'Modo lento',
          screenNotice(screened, fan.locale) ?? undefined,
          {
            headers: { 'retry-after': String(screened.retryAfterS ?? eff.slowModeSeconds) },
          },
        );
      // rigor `strict`: o palavrão leve também volta para o autor, com aviso
      const strictBlock = eff.strictness === 'strict' && screened.reasons.includes('profanity');
      if (screened.action === 'block' || strictBlock)
        throw problems.invalidParams(
          [{ path: 'body', message: screenNotice(screened, fan.locale) ?? 'Mensagem não permitida.' }],
          'Mensagem recusada pelas regras do chat.',
        );

      const visibility = screened.action === 'shadow' || shadowMuted ? 'shadow' : 'public';
      const flags = [
        ...screened.reasons,
        ...(screened.suspect ? ['suspect'] : []),
        ...(shadowMuted ? ['muted'] : []),
      ];
      const purgeAt = await purgeAtFor(fan.tenantId, profile.country, at);
      // anti-flood por pessoa, em todas as salas do cliente (no lugar do modo escudo): só conta a mensagem que passou
      // do modo lento e do filtro (tentativa recusada não vira repetição). Passou do limite em 60 s ou repetiu a mesma
      // mensagem, fica o bloqueio. Valkey fora não barra ninguém (o modo lento continua valendo), mas fica no log
      const floodLeft = await flood
        .hit(fan.tenantId, fan.profileId, text, eff.flood, at.getTime())
        .catch((err: unknown) => {
          if (Date.now() - floodErrorAt > 60_000) {
            floodErrorAt = Date.now();
            request.log.warn({ err }, 'anti-flood do chat indisponível; envio liberado');
          }
          return 0;
        });
      if (floodLeft > 0)
        throw new ProblemError(
          429,
          'RATE_LIMITED',
          'Muitas mensagens',
          sendRefusalNotice('flood', fan.locale),
          {
            headers: { 'retry-after': String(Math.ceil(floodLeft / 1000)) },
            errors: [{ path: 'refusal', message: 'flood' }],
          },
        );
      // robô (#1290): ritmo de máquina trava o envio e abre caso na fila; Conta com vários Perfis na sala e o mesmo
      // link entre Perfis só marcam a mensagem para a Cosmos e a fila. Valkey fora não barra ninguém
      const verified = profile.ageAssurance === 'verified';
      const botVerdict = await bot
        .check({
          tenantId: fan.tenantId,
          roomId: room.id,
          profileId: fan.profileId,
          accountId: profile.accountId,
          links: botLinks(text, linkHosts(text)),
          verified,
          slowModeMs: eff.slowModeSeconds * 1000,
          now: at.getTime(),
        })
        .catch((err: unknown) => {
          if (Date.now() - botErrorAt > 60_000) {
            botErrorAt = Date.now();
            request.log.warn({ err }, 'detecção de robô do chat indisponível; envio liberado');
          }
          return { blockedMs: 0, blockedNow: false, signals: [] };
        });
      if (botVerdict.blockedNow)
        await holdBotCase(
          fan.tenantId,
          room.id,
          fan.profileId,
          profile.country,
          botVerdict.signals,
          text,
          at,
        ).catch((err: unknown) => request.log.error({ err }, 'chat: caso de robô não aberto'));
      if (botVerdict.blockedMs > 0)
        throw new ProblemError(429, 'RATE_LIMITED', 'Envio pausado', sendRefusalNotice('bot', fan.locale), {
          headers: { 'retry-after': String(Math.ceil(botVerdict.blockedMs / 1000)) },
          errors: [{ path: 'refusal', message: 'bot' }],
        });
      if (botVerdict.signals.length > 0) {
        if (!flags.includes('suspect')) flags.push('suspect');
        flags.push(...botVerdict.signals);
      }
      const saved = await insertMessage(
        database,
        {
          tenantId: fan.tenantId,
          roomId: room.id,
          profileId: fan.profileId,
          body: text,
          visibility,
          flags,
          purgeAt,
        },
        { seconds: eff.slowModeSeconds, now: at },
      );
      if (!saved.ok)
        throw new ProblemError(
          429,
          'RATE_LIMITED',
          'Modo lento',
          `Espere ${saved.retryAfterS} s para mandar outra mensagem.`,
          { headers: { 'retry-after': String(saved.retryAfterS) } },
        );
      const view = messageView({
        id: saved.id,
        body: text,
        profileId: fan.profileId,
        nickname: profile.nickname,
        // a mensagem vai para a sala: só a foto liberada pela moderação (#1025)
        avatarUrl: (await publicAvatars(database, fan.tenantId, [fan.profileId])).get(fan.profileId) ?? null,
        avatarVisibility: profile.visibility.avatar,
        createdAt: saved.createdAt,
      });
      // só a mensagem pública entra no lote; a retida fica com o autor (ele a vê pela resposta)
      // Valkey fora: a mensagem já está gravada e aparece pelo GET; o envio não volta com erro (o torcedor não repete)
      if (visibility === 'public')
        await hub.enqueue(ChatHub.roomKey(fan.tenantId, fixtureId), view).catch((err: unknown) => {
          request.log.warn({ err }, 'chat: fila do lote indisponível');
        });
      await peak.seat(fan.tenantId, fan.profileId).catch((err: unknown) => {
        request.log.warn({ err }, 'chat: lugar do torcedor indisponível');
      });
      reply.header('cache-control', 'no-store');
      const res: ChatMessageResponse = {
        data: { ...view, status: visibility === 'public' ? 'published' : 'held' },
      };
      return reply.code(201).send(res);
    },
  );

  // reconexão em massa (deploy, pico): a lista do jogo e os tipos do cliente vêm de um cache curto
  const shortCache = <T>(ttlMs: number, load: (k: string) => Promise<T>) => {
    const map = new Map<string, { at: number; value: Promise<T> }>();
    return (k: string): Promise<T> => {
      const hit = map.get(k);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      const value = load(k);
      value.catch(() => map.delete(k));
      if (map.size > 10_000) map.clear();
      map.set(k, { at: Date.now(), value });
      return value;
    };
  };
  const cachedGame = shortCache(1_000, (fixtureId) => gameMessages(db(), fixtureId));
  const cachedKinds = shortCache(
    30_000,
    async (tenantId) => (await readTenantConfig(db(), tenantId)).eventKinds,
  );

  registerChatStream(app, {
    db: deps.db,
    hub,
    peak,
    options: deps.stream ?? {},
    // leitura: não cria a sala (a chave publicável abre o stream); os lotes são por jogo e cliente
    roomState: async (tenantId, fixtureId) => (await loadRoom(tenantId, fixtureId, false)).window.state,
    gameKinds: (tenantId) => cachedKinds(tenantId),
    gameSnapshot: (fixtureId) => cachedGame(fixtureId),
    reactionTotals: (tenantId, fixtureId) => reactions.totals(`${tenantId}:${fixtureId}`),
  });

  async function configBody(tenantId: string): Promise<ChatConfig> {
    const [cfg, g] = await Promise.all([readTenantConfig(db(), tenantId), settings.get()]);
    const eff = effective(null, cfg, g);
    return {
      data: {
        open_before_minutes: eff.openBeforeMinutes,
        close_after_minutes: eff.closeAfterMinutes,
        slow_mode_seconds: eff.slowModeSeconds,
        strictness: eff.strictness,
        event_kinds: eff.eventKinds ?? [...CHAT_GAME_KINDS],
        flood_max_per_minute: eff.flood.maxPerMinute,
        flood_block_seconds: eff.flood.blockSeconds,
        custom: Object.entries(cfg)
          .filter(([, v]) => v !== null)
          .map(([k]) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)),
      },
    };
  }

  // `authenticated` (não `module`): a configuração não é leitura pública, a chave publicável fica de fora
  const configRoute = async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = secretTenant(request);
    if (!tenant.modules.includes('live_chat')) throw problems.moduleNotInPlan('live_chat');
    reply.header('cache-control', 'no-store');
    if (request.method === 'PUT') {
      const body = parseInput(ChatConfigBody, request.body);
      await writeTenantConfig(db(), tenant.tenantId, body, `tenant:${tenant.keyPrefix}`);
    }
    return configBody(tenant.tenantId);
  };
  app.get('/v1/chat/config', { config: { authenticated: true } }, configRoute);
  app.put('/v1/chat/config', { config: { authenticated: true } }, configRoute);
}
