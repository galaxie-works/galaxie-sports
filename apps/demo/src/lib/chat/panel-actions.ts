'use server';

/**
 * Ações do painel do Chat ao vivo (#973): tirar e devolver uma mensagem, congelar e reabrir a sala, modo lento,
 * silenciar (visível ou oculto), suspender e banir o autor, e o padrão do cliente para as salas. O tenant e o cargo
 * saem da sessão, nunca do navegador; cada ação confere o cargo (#1019) na sala (o id do jogo) e entra na auditoria
 * da base (#953) com os relógios da ficha do país (D5).
 */
import { applySanction, recordModerationDecision, type ModerationActor } from '@galaxie/db/moderation-queue';
import { SANCTION_SCOPE, checkSanction, sanctionAction } from '@galaxie/engage';

import { pool } from '@/lib/auth/db';
import { builderDb } from '@/lib/builder/store';
import { allowed } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { clocksFor, NoPolicyError } from '@/lib/moderation/clocks';

import { loadChatRoom, loadRoomMessages, profileInRoom, type PanelMessage } from './panel-data';
import {
  AUTHOR_ACTION_RULE,
  ROOM_ACTION_RULE,
  authorActionSeconds,
  isAuthorAction,
  isSlowModeOption,
  sanctionOf,
  type AuthorAction,
} from './panel-utils';

export interface ChatActionResult {
  ok: boolean;
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GAME_KINDS = ['kickoff', 'goal', 'red_card', 'var', 'half_time', 'full_time'];

async function session() {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const T = getDictionary(locale).chatPanel.errors;
  if (!ctx?.tenant || !ctx.actor) return { error: T.forbidden } as const;
  const actor: ModerationActor =
    ctx.actor.kind === 'galaxie_staff'
      ? { id: `galaxie:${ctx.userId}`, kind: 'galaxie' }
      : { id: `user:${ctx.userId}`, kind: 'person' };
  return { ctx: { ...ctx, tenant: ctx.tenant }, actor, T } as const;
}

/** Mensagens novas da sala para o painel ao vivo (o navegador pede a cada poucos segundos). */
export async function roomMessagesAction(fixtureId: string): Promise<PanelMessage[] | null> {
  const s = await session();
  if ('error' in s || !UUID.test(fixtureId)) return null;
  if (!allowed(s.ctx, 'moderation.queue.view', { room: fixtureId }).ok) return null;
  const room = await loadChatRoom(s.ctx.tenant.id, fixtureId);
  return room ? loadRoomMessages(s.ctx.tenant.id, room.roomId) : [];
}

/** Tira do ar (ou devolve) uma mensagem da sala. O texto fica para a auditoria e a apelação. */
export async function setMessageHiddenAction(input: {
  fixtureId: string;
  messageId: string;
  hidden: boolean;
}): Promise<ChatActionResult> {
  const s = await session();
  if ('error' in s) return { ok: false, error: s.error };
  const { ctx, actor, T } = s;
  if (!UUID.test(input.fixtureId) || !UUID.test(input.messageId)) return { ok: false, error: T.invalid };
  if (!allowed(ctx, 'moderation.hide', { room: input.fixtureId }).ok) return { ok: false, error: T.role };
  const room = await loadChatRoom(ctx.tenant.id, input.fixtureId);
  if (!room) return { ok: false, error: T.notFound };
  const { rows } = await pool.query<{ profile_id: string }>(
    `update chat.message set visibility = $4
      where tenant_id = $1 and room_id = $2 and id = $3 and visibility <> $4
      returning profile_id`,
    [ctx.tenant.id, room.roomId, input.messageId, input.hidden ? 'hidden' : 'public'],
  );
  const row = rows[0];
  if (!row) return { ok: true };
  try {
    const clocks = await clocksFor(ctx.tenant.id, row.profile_id);
    await recordModerationDecision(builderDb(), {
      tenantId: ctx.tenant.id,
      actor,
      action: input.hidden ? 'chat.hide' : 'chat.restore',
      clocks,
      subjectProfileId: row.profile_id,
      reason: input.hidden ? 'chat.hide' : 'chat.restore',
      rules: { room: input.fixtureId, message: input.messageId },
    });
  } catch (err) {
    if (!(err instanceof NoPolicyError)) console.error('[chat] auditoria falhou', { err });
  }
  return { ok: true };
}

/** Congela, reabre ou muda o modo lento da sala (cria a sala se ninguém escreveu ainda). */
export async function roomAction(input: {
  fixtureId: string;
  action: 'freeze' | 'open' | 'slow_mode';
  slowModeSeconds?: number | null;
}): Promise<ChatActionResult> {
  const s = await session();
  if ('error' in s) return { ok: false, error: s.error };
  const { ctx, actor, T } = s;
  if (!UUID.test(input.fixtureId)) return { ok: false, error: T.invalid };
  if (input.action === 'slow_mode' && !isSlowModeOption(input.slowModeSeconds ?? null))
    return { ok: false, error: T.invalid };
  if (!allowed(ctx, ROOM_ACTION_RULE, { room: input.fixtureId }).ok) return { ok: false, error: T.role };
  const exists = await pool.query(`select 1 from core.event where id = $1`, [input.fixtureId]);
  if (!exists.rowCount) return { ok: false, error: T.notFound };
  const by = actor.kind === 'galaxie' ? actor.id : `tenant:${actor.id}`;
  await pool.query(
    `insert into chat.room (tenant_id, event_id) values ($1, $2) on conflict (tenant_id, event_id) do nothing`,
    [ctx.tenant.id, input.fixtureId],
  );
  if (input.action === 'slow_mode') {
    await pool.query(
      `update chat.room set slow_mode_seconds = $3, updated_at = now() where tenant_id = $1 and event_id = $2`,
      [ctx.tenant.id, input.fixtureId, input.slowModeSeconds ?? null],
    );
  } else {
    // o pico do plano (D6) não sai pelo painel; o congelamento da Galaxie só a Galaxie desfaz
    const { rowCount } = await pool.query(
      `update chat.room set state = $3, state_by = $4, state_at = now(), updated_at = now()
        where tenant_id = $1 and event_id = $2 and state <> 'read_only_peak'
          and ($5 or state_by is null or state_by not like 'galaxie:%')`,
      [
        ctx.tenant.id,
        input.fixtureId,
        input.action === 'freeze' ? 'frozen' : 'open',
        by,
        actor.kind === 'galaxie',
      ],
    );
    if (!rowCount) return { ok: false, error: T.locked };
  }
  try {
    const clocks = await clocksFor(ctx.tenant.id, null);
    await recordModerationDecision(builderDb(), {
      tenantId: ctx.tenant.id,
      actor,
      action: `chat.${input.action}`,
      clocks,
      reason: `chat.${input.action}`,
      rules: {
        room: input.fixtureId,
        ...(input.action === 'slow_mode' ? { slowModeSeconds: input.slowModeSeconds ?? null } : {}),
      },
    });
  } catch (err) {
    if (!(err instanceof NoPolicyError)) console.error('[chat] auditoria falhou', { err });
  }
  return { ok: true };
}

/** Silencia (visível ou oculto), suspende ou bane o autor de uma mensagem da sala. */
export async function authorAction(input: {
  fixtureId: string;
  profileId: string;
  action: AuthorAction;
  /** Minutos (silêncio) ou dias (suspensão). */
  amount?: number;
  note?: string;
}): Promise<ChatActionResult> {
  const s = await session();
  if ('error' in s) return { ok: false, error: s.error };
  const { ctx, actor, T } = s;
  if (!UUID.test(input.fixtureId) || !UUID.test(input.profileId) || !isAuthorAction(input.action))
    return { ok: false, error: T.invalid };
  const seconds = authorActionSeconds(input.action, input.amount);
  if (seconds === null) return { ok: false, error: T.invalid };
  const { level, hidden } = sanctionOf(input.action);
  const gate = allowed(ctx, AUTHOR_ACTION_RULE[input.action], {
    room: input.fixtureId,
    ...(level === 'mute' ? { durationSec: seconds } : {}),
  });
  if (!gate.ok) return { ok: false, error: T.role };
  // a ação vale para quem está na sala da ação (o moderador de uma sala não pune por id de qualquer torcedor)
  const room = await loadChatRoom(ctx.tenant.id, input.fixtureId);
  if (!room || !(await profileInRoom(ctx.tenant.id, room.roomId, input.profileId)))
    return { ok: false, error: T.notFound };

  const now = new Date();
  const scope = SANCTION_SCOPE[level];
  const endsAt = level === 'ban' ? null : new Date(now.getTime() + seconds * 1000);
  const problems = checkSanction(
    {
      level,
      hidden,
      decidedBy: 'person',
      endsAt: endsAt?.getTime() ?? null,
      scopeId: scope === 'place' ? input.fixtureId : null,
    },
    { now: now.getTime(), hiddenEnabled: true, policy: null },
  );
  if (problems.length) return { ok: false, error: T.invalid };
  // a ação da matriz depende do degrau (o oculto é outra ação); confere de novo pelo nível
  if (!allowed(ctx, sanctionAction(level, hidden), { room: input.fixtureId }).ok)
    return { ok: false, error: T.role };

  let clocks;
  try {
    clocks = await clocksFor(ctx.tenant.id, input.profileId, now);
  } catch (err) {
    if (err instanceof NoPolicyError) return { ok: false, error: T.noPolicy };
    throw err;
  }
  try {
    await applySanction(builderDb(), {
      tenantId: ctx.tenant.id,
      profileId: input.profileId,
      accountId: null,
      level,
      hidden,
      scope,
      scopeId: scope === 'place' ? input.fixtureId : null,
      reason: `chat.${input.action}`,
      caseId: null,
      actor,
      endsAt,
      clocks,
      rules: {
        from: 'chat_panel',
        room: input.fixtureId,
        ...(input.note ? { note: input.note.trim().slice(0, 500) } : {}),
      },
      now,
    });
    return { ok: true };
  } catch (err) {
    console.error('[chat] punição falhou', { tenantId: ctx.tenant.id, err });
    return { ok: false, error: T.generic };
  }
}

/** Padrão do cliente para as salas (janela, modo lento, rigor, tipos de lance do jogo). `null` volta ao padrão. */
export async function saveChatSettingsAction(input: {
  openBeforeMinutes: number | null;
  closeAfterMinutes: number | null;
  slowModeSeconds: number | null;
  strictness: 'standard' | 'strict' | null;
  eventKinds: string[] | null;
}): Promise<ChatActionResult> {
  const s = await session();
  if ('error' in s) return { ok: false, error: s.error };
  const { ctx, actor, T } = s;
  if (!allowed(ctx, 'settings.manage').ok) return { ok: false, error: T.role };
  const minutes = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v <= 1440);
  const okSlow =
    input.slowModeSeconds === null ||
    (Number.isInteger(input.slowModeSeconds) && input.slowModeSeconds >= 0 && input.slowModeSeconds <= 600);
  const okStrict =
    input.strictness === null || input.strictness === 'standard' || input.strictness === 'strict';
  const okKinds = input.eventKinds === null || input.eventKinds.every((k) => GAME_KINDS.includes(k));
  if (
    !minutes(input.openBeforeMinutes) ||
    !minutes(input.closeAfterMinutes) ||
    !okSlow ||
    !okStrict ||
    !okKinds
  )
    return { ok: false, error: T.invalid };
  const by = actor.kind === 'galaxie' ? actor.id : `tenant:${actor.id}`;
  await pool.query(
    `insert into chat.tenant_config
       (tenant_id, open_before_minutes, close_after_minutes, slow_mode_seconds, strictness, event_kinds, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (tenant_id) do update set
       open_before_minutes = excluded.open_before_minutes, close_after_minutes = excluded.close_after_minutes,
       slow_mode_seconds = excluded.slow_mode_seconds, strictness = excluded.strictness,
       event_kinds = excluded.event_kinds, updated_by = excluded.updated_by, updated_at = now()`,
    [
      ctx.tenant.id,
      input.openBeforeMinutes,
      input.closeAfterMinutes,
      input.slowModeSeconds,
      input.strictness,
      input.eventKinds ? [...new Set(input.eventKinds)] : null,
      by,
    ],
  );
  return { ok: true };
}
