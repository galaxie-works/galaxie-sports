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
  ChatRoomParams,
  ChatRoomPatchBody,
  type ChatConfig,
  type ChatMessageResponse,
  type ChatRoom,
} from '@galaxie/contracts';
import { activeSanctions, type ChatStrictness, type Database } from '@galaxie/db';
import {
  canReadRoom,
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
import { fanCan } from '../engage/fan-rules.js';
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
  recentMessages,
  tenantHasLiveChat,
  writeTenantConfig,
  type ChatMessageRow,
  type ChatRoomRow,
  type ChatTenantConfigRow,
} from './rooms.js';
import { ChatSettings, type ChatSettingsValues } from './settings.js';

export interface ChatRoutesDeps {
  db: Database | undefined;
  settings?: ChatSettings | undefined;
  now?: (() => Date) | undefined;
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
    const messages =
      room && visible.includes(window.state)
        ? await recentMessages(db(), tenantId, room.id, eff.historyOnJoin)
        : [];
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

  app.post('/v1/chat/rooms/:fixtureId/messages', { config: { fan: true } }, async (request, reply) => {
    const fan = request.fan!;
    const { fixtureId } = parseInput(ChatRoomParams, request.params);
    const body = parseInput(ChatMessageBody, request.body);
    const database = db();
    if (!(await tenantHasLiveChat(database, fan.tenantId))) throw problems.moduleNotInPlan('live_chat');
    if (!canReadRoom(fan.ageBand))
      throw problems.fanAgeRestricted('Perfis com menos de 13 anos não usam os recursos sociais.');
    if (!fanCan(fan.ageBand, 'write'))
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
    if (!fanCan(profile.ageBand, 'write'))
      throw problems.fanAgeRestricted(sendRefusalNotice('age_band', fan.locale));

    // Suspensão e Banimento valem em todas as salas do cliente; Silenciar, só onde aconteceu. O Silêncio oculto não
    // recusa: a mensagem fica só para o autor (ele não é avisado, é a exceção ao aviso)
    const here = (s: { scope: string; scopeId: string | null }) =>
      s.scope === 'tenant' || (s.scope === 'place' && s.scopeId === room.id);
    const blocking = sanctions.find(
      (s) => here(s) && (s.level === 'suspension' || s.level === 'ban' || (s.level === 'mute' && !s.hidden)),
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
    reply.header('cache-control', 'no-store');
    const res: ChatMessageResponse = {
      data: {
        ...messageView({
          id: saved.id,
          body: text,
          profileId: fan.profileId,
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl,
          avatarVisibility: profile.visibility.avatar,
          createdAt: saved.createdAt,
        }),
        status: visibility === 'public' ? 'published' : 'held',
      },
    };
    return reply.code(201).send(res);
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
