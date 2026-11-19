'use server';

/**
 * Ações do painel do Chat ao vivo (#973): tirar e devolver uma mensagem, congelar e reabrir a sala, modo lento,
 * silenciar (visível ou oculto), suspender e banir o autor, e o padrão do cliente para as salas. O tenant e o cargo
 * saem da sessão, nunca do navegador; cada ação confere o cargo (#1019) na sala (o id do jogo) e entra na auditoria
 * da base (#953) com os relógios da ficha do país (D5).
 */
import { applySanction, recordModerationDecision, type ModerationActor } from '@galaxie/db/moderation-queue';
import { SANCTION_SCOPE, checkSanction, retentionDeadlines, sanctionAction } from '@galaxie/engage';
import { sql } from 'drizzle-orm';

import { pool } from '@/lib/auth/db';
import { builderDb } from '@/lib/builder/store';
import { allowed } from '@/lib/client/permissions';
import { withStaffAudit } from '@/lib/client/staff';
import { readClientContext } from '@/lib/client/session';

import { hasLiveChat } from './access';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { clocksFor, NoPolicyError, policyFor } from '@/lib/moderation/clocks';

import { canonicalTerms } from '@/lib/engage/moderation-lists';
import { loadChatSettings, loadRoomMessages, profileInRoom, type PanelMessage } from './panel-data';
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

/** Id do jogo em minúsculas (o escopo do cargo e o da punição comparam texto). */
const fixtureOf = (raw: string): string | null => (UUID.test(raw) ? raw.toLowerCase() : null);

/** Id da sala do jogo no tenant, sem nada mais (a consulta do painel ao vivo, a cada 3 s, tem de ser leve). */
async function roomIdOf(tenantId: string, fixtureId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from chat.room where tenant_id = $1 and event_id = $2 limit 1`,
    [tenantId, fixtureId],
  );
  return rows[0]?.id ?? null;
}

/** Mensagens da sala para o painel ao vivo (o navegador pede a cada poucos segundos). */
export async function roomMessagesAction(rawFixtureId: string): Promise<PanelMessage[] | null> {
  const s = await session();
  const fixtureId = fixtureOf(rawFixtureId);
  if ('error' in s || !fixtureId || !hasLiveChat(s.ctx)) return null;
  if (!allowed(s.ctx, 'moderation.queue.view', { room: fixtureId }).ok) return null;
  const roomId = await roomIdOf(s.ctx.tenant.id, fixtureId);
  return roomId ? loadRoomMessages(s.ctx.tenant.id, roomId) : [];
}

/**
 * Tira do ar (ou devolve) uma mensagem da sala. Devolver volta ao que era antes: a mensagem retida (abuso ou Silêncio
 * oculto) volta a ser vista só pelo autor, nunca é publicada por aqui. O texto fica para a auditoria e a apelação. A
 * mudança e a auditoria entram juntas (sem ficha do país, nenhuma das duas).
 */
export const setMessageHiddenAction = withStaffAudit(
  'chat.message.hide',
  async function setMessageHiddenAction(input: {
    fixtureId: string;
    messageId: string;
    hidden: boolean;
  }): Promise<ChatActionResult> {
    const s = await session();
    if ('error' in s) return { ok: false, error: s.error };
    const { ctx, actor, T } = s;
    const fixtureId = fixtureOf(input.fixtureId);
    if (!fixtureId || !UUID.test(input.messageId)) return { ok: false, error: T.invalid };
    if (!hasLiveChat(ctx)) return { ok: false, error: T.role };
    if (!allowed(ctx, 'moderation.hide', { room: fixtureId }).ok) return { ok: false, error: T.role };
    const roomId = await roomIdOf(ctx.tenant.id, fixtureId);
    if (!roomId) return { ok: false, error: T.notFound };
    const author = await pool.query<{ profile_id: string }>(
      `select profile_id from chat.message where tenant_id = $1 and room_id = $2 and id = $3`,
      [ctx.tenant.id, roomId, input.messageId],
    );
    const profileId = author.rows[0]?.profile_id;
    if (!profileId) return { ok: false, error: T.notFound };
    let clocks;
    try {
      clocks = await clocksFor(ctx.tenant.id, profileId);
    } catch (err) {
      if (err instanceof NoPolicyError) return { ok: false, error: T.noPolicy };
      throw err;
    }
    const db = builderDb();
    await db.transaction(async (tx) => {
      const changed = input.hidden
        ? await tx.execute(sql`
          update chat.message
             set visibility = 'hidden',
                 flags = case when visibility = 'shadow' then array_append(flags, 'was_shadow') else flags end
           where tenant_id = ${ctx.tenant.id} and room_id = ${roomId} and id = ${input.messageId}
             and visibility <> 'hidden'
          returning id`)
        : await tx.execute(sql`
          update chat.message
             set visibility = case when 'was_shadow' = any(flags) then 'shadow' else 'public' end,
                 flags = array_remove(flags, 'was_shadow')
           where tenant_id = ${ctx.tenant.id} and room_id = ${roomId} and id = ${input.messageId}
             and visibility = 'hidden'
             -- guarda legal (#1289): denunciada às autoridades não volta ao ar
             and (legal_hold_until is null or legal_hold_until <= now())
          returning id`);
      if (!changed.length) return;
      // mensagem fora do ar não fica fixada
      if (input.hidden)
        await tx.execute(sql`
        update chat.room set pinned_message_id = null, pinned_by = null, pinned_at = null, updated_at = now()
         where tenant_id = ${ctx.tenant.id} and id = ${roomId} and pinned_message_id = ${input.messageId}`);
      await recordModerationDecision(tx as unknown as typeof db, {
        tenantId: ctx.tenant.id,
        actor,
        action: input.hidden ? 'chat.hide' : 'chat.restore',
        clocks,
        subjectProfileId: profileId,
        reason: input.hidden ? 'chat.hide' : 'chat.restore',
        rules: { room: fixtureId, message: input.messageId },
      });
    });
    return { ok: true };
  },
);

/**
 * Fixa uma mensagem pública no topo da sala (ou desafixa, com `messageId` null). Uma fixada por sala: fixar outra
 * troca. Mensagem retida ou fora do ar não se fixa.
 */
export const pinMessageAction = withStaffAudit(
  'chat.message.pin',
  async function pinMessageAction(input: {
    fixtureId: string;
    messageId: string | null;
  }): Promise<ChatActionResult> {
    const s = await session();
    if ('error' in s) return { ok: false, error: s.error };
    const { ctx, actor, T } = s;
    const fixtureId = fixtureOf(input.fixtureId);
    if (!fixtureId || (input.messageId !== null && !UUID.test(input.messageId)))
      return { ok: false, error: T.invalid };
    if (!hasLiveChat(ctx)) return { ok: false, error: T.role };
    if (!allowed(ctx, 'moderation.pin', { room: fixtureId }).ok) return { ok: false, error: T.role };
    const roomId = await roomIdOf(ctx.tenant.id, fixtureId);
    if (!roomId) return { ok: false, error: T.notFound };
    let profileId: string | null = null;
    if (input.messageId) {
      const msg = await pool.query<{ profile_id: string }>(
        `select profile_id from chat.message
        where tenant_id = $1 and room_id = $2 and id = $3 and visibility = 'public'`,
        [ctx.tenant.id, roomId, input.messageId],
      );
      profileId = msg.rows[0]?.profile_id ?? null;
      if (!profileId) return { ok: false, error: T.notPinnable };
    }
    let clocks;
    try {
      clocks = await clocksFor(ctx.tenant.id, profileId);
    } catch (err) {
      if (err instanceof NoPolicyError) return { ok: false, error: T.noPolicy };
      throw err;
    }
    const by = actor.kind === 'galaxie' ? actor.id : `tenant:${actor.id}`;
    const db = builderDb();
    await db.transaction(async (tx) => {
      const changed = input.messageId
        ? await tx.execute(sql`
          update chat.room
             set pinned_message_id = ${input.messageId}, pinned_by = ${by}, pinned_at = now(), updated_at = now()
           where tenant_id = ${ctx.tenant.id} and id = ${roomId}
             and pinned_message_id is distinct from ${input.messageId}
             and exists (select 1 from chat.message m
                          where m.tenant_id = ${ctx.tenant.id} and m.room_id = ${roomId}
                            and m.id = ${input.messageId} and m.visibility = 'public')
          returning id`)
        : await tx.execute(sql`
          update chat.room set pinned_message_id = null, pinned_by = null, pinned_at = null, updated_at = now()
           where tenant_id = ${ctx.tenant.id} and id = ${roomId} and pinned_message_id is not null
          returning id`);
      if (!changed.length) return;
      await recordModerationDecision(tx as unknown as typeof db, {
        tenantId: ctx.tenant.id,
        actor,
        action: input.messageId ? 'chat.pin' : 'chat.unpin',
        clocks,
        ...(profileId ? { subjectProfileId: profileId } : {}),
        reason: input.messageId ? 'chat.pin' : 'chat.unpin',
        rules: { room: fixtureId, ...(input.messageId ? { message: input.messageId } : {}) },
      });
    });
    return { ok: true };
  },
);

/** Congela, reabre ou muda o modo lento da sala (cria a sala se ninguém escreveu ainda), com a auditoria junto. */
export const roomAction = withStaffAudit(
  'chat.room',
  async function roomAction(input: {
    fixtureId: string;
    action: 'freeze' | 'open' | 'slow_mode';
    slowModeSeconds?: number | null;
  }): Promise<ChatActionResult> {
    const s = await session();
    if ('error' in s) return { ok: false, error: s.error };
    const { ctx, actor, T } = s;
    const fixtureId = fixtureOf(input.fixtureId);
    if (!fixtureId) return { ok: false, error: T.invalid };
    if (input.action === 'slow_mode' && !isSlowModeOption(input.slowModeSeconds ?? null))
      return { ok: false, error: T.invalid };
    if (!hasLiveChat(ctx)) return { ok: false, error: T.role };
    if (!allowed(ctx, ROOM_ACTION_RULE, { room: fixtureId }).ok) return { ok: false, error: T.role };
    const exists = await pool.query(`select 1 from core.event where id = $1`, [fixtureId]);
    if (!exists.rowCount) return { ok: false, error: T.notFound };
    let clocks;
    try {
      clocks = await clocksFor(ctx.tenant.id, null);
    } catch (err) {
      if (err instanceof NoPolicyError) return { ok: false, error: T.noPolicy };
      throw err;
    }
    const by = actor.kind === 'galaxie' ? actor.id : `tenant:${actor.id}`;
    const isGalaxie = actor.kind === 'galaxie';
    const db = builderDb();
    const ok = await db.transaction(async (tx) => {
      await tx.execute(sql`
      insert into chat.room (tenant_id, event_id) values (${ctx.tenant.id}, ${fixtureId})
      on conflict (tenant_id, event_id) do nothing`);
      let changed;
      if (input.action === 'slow_mode') {
        changed = await tx.execute(sql`
        update chat.room set slow_mode_seconds = ${input.slowModeSeconds ?? null}, updated_at = now()
         where tenant_id = ${ctx.tenant.id} and event_id = ${fixtureId}
        returning id`);
      } else {
        // o pico do plano (D6) não sai pelo painel; só reabrir o que a Galaxie congelou é que é só da Galaxie (o
        // cliente pode congelar uma sala que a Galaxie reabriu)
        changed = await tx.execute(sql`
        update chat.room
           set state = ${input.action === 'freeze' ? 'frozen' : 'open'}, state_by = ${by}, state_at = now(),
               updated_at = now()
         where tenant_id = ${ctx.tenant.id} and event_id = ${fixtureId} and state <> 'read_only_peak'
           and (${isGalaxie} or ${input.action === 'freeze'} or state <> 'frozen' or state_by is null
                or state_by not like 'galaxie:%')
        returning id`);
      }
      if (!changed.length) return false;
      await recordModerationDecision(tx as unknown as typeof db, {
        tenantId: ctx.tenant.id,
        actor,
        action: `chat.${input.action}`,
        clocks,
        reason: `chat.${input.action}`,
        rules: {
          room: fixtureId,
          ...(input.action === 'slow_mode' ? { slowModeSeconds: input.slowModeSeconds ?? null } : {}),
        },
      });
      return true;
    });
    return ok ? { ok: true } : { ok: false, error: T.locked };
  },
);

/** Silencia (visível ou oculto), suspende ou bane o autor de uma mensagem da sala. */
export const authorAction = withStaffAudit(
  'chat.author',
  async function authorAction(input: {
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
    const fixtureId = fixtureOf(input.fixtureId);
    if (!fixtureId || !UUID.test(input.profileId) || !isAuthorAction(input.action))
      return { ok: false, error: T.invalid };
    if (!hasLiveChat(ctx)) return { ok: false, error: T.role };
    const seconds = authorActionSeconds(input.action, input.amount);
    if (seconds === null) return { ok: false, error: T.invalid };
    const { level, hidden } = sanctionOf(input.action);
    const gate = allowed(ctx, AUTHOR_ACTION_RULE[input.action], {
      room: fixtureId,
      ...(level === 'mute' ? { durationSec: seconds } : {}),
    });
    if (!gate.ok) return { ok: false, error: T.role };
    // a ação vale para quem está na sala da ação (o moderador de uma sala não pune por id de qualquer torcedor)
    const roomId = await roomIdOf(ctx.tenant.id, fixtureId);
    if (!roomId || !(await profileInRoom(ctx.tenant.id, roomId, input.profileId)))
      return { ok: false, error: T.notFound };

    const now = new Date();
    // a ficha do país do torcedor decide o Silêncio oculto (país que exige aviso de punição não deixa) e os relógios
    const policy = await policyFor(ctx.tenant.id, input.profileId);
    if (!policy) return { ok: false, error: T.noPolicy };
    const scope = SANCTION_SCOPE[level];
    const endsAt = level === 'ban' ? null : new Date(now.getTime() + seconds * 1000);
    const problems = checkSanction(
      {
        level,
        hidden,
        decidedBy: 'person',
        endsAt: endsAt?.getTime() ?? null,
        scopeId: scope === 'place' ? fixtureId : null,
      },
      // o Silêncio oculto fica ligado para quem o cargo deixa (`moderation.shadow_mute`, que o Dono pode tirar)
      { now: now.getTime(), hiddenEnabled: hidden, policy },
    );
    if (problems.includes('hidden_not_allowed')) return { ok: false, error: T.shadowNotAllowed };
    if (problems.length) return { ok: false, error: T.invalid };
    // a ação da matriz depende do degrau (o oculto é outra ação); confere de novo pelo nível
    if (
      !allowed(ctx, sanctionAction(level, hidden), {
        room: fixtureId,
        ...(level === 'mute' ? { durationSec: seconds } : {}),
      }).ok
    )
      return { ok: false, error: T.role };

    const deadlines = retentionDeadlines(policy, now.getTime());
    const clocks = {
      contentPurgeAt: new Date(deadlines.contentPurgeAt),
      decisionPurgeAt: new Date(deadlines.decisionPurgeAt),
    };
    try {
      await applySanction(builderDb(), {
        tenantId: ctx.tenant.id,
        profileId: input.profileId,
        accountId: null,
        level,
        hidden,
        scope,
        scopeId: scope === 'place' ? fixtureId : null,
        reason: `chat.${input.action}`,
        caseId: null,
        actor,
        endsAt,
        clocks,
        rules: {
          from: 'chat_panel',
          room: fixtureId,
          ...(input.note ? { note: input.note.trim().slice(0, 500) } : {}),
        },
        now,
      });
      return { ok: true };
    } catch (err) {
      console.error('[chat] punição falhou', { tenantId: ctx.tenant.id, err });
      return { ok: false, error: T.generic };
    }
  },
);

/** Perfis oficiais por cliente: bem menos que o teto das listas (cada um é um `@` liberado à mão). */
const MAX_HANDLES = 200;

/** Lista `allowed_handles` do cliente: cria ou troca, com a versão e o histórico na mesma transação. */
async function saveTenantHandles(tenantId: string, handles: string[], by: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string; version: number; terms: string[] }>(
      `select id, version, terms from engage.moderation_list
        where tenant_id = $1 and list = 'allowed_handles' and locale = 'all' for update`,
      [tenantId],
    );
    const prev = rows[0] ?? null;
    if ((prev ? prev.terms.join('\n') : '') === handles.join('\n')) {
      await client.query('rollback');
      return true;
    }
    const version = (prev?.version ?? 0) + 1;
    const { rows: saved } = await client.query<{ id: string }>(
      prev
        ? `update engage.moderation_list set terms = $2::text[], version = $3, updated_by = $4, updated_at = now()
            where id = $1 returning id`
        : `insert into engage.moderation_list (tenant_id, list, locale, terms, version, updated_by)
            values ($1, 'allowed_handles', 'all', $2::text[], $3, $4) returning id`,
      prev ? [prev.id, handles, version, by] : [tenantId, handles, version, by],
    );
    await client.query(
      `insert into engage.moderation_list_log (list_id, tenant_id, list, locale, version, terms, changed_by, reason)
       values ($1, $2, 'allowed_handles', 'all', $3, $4::text[], $5, 'chat.settings')`,
      [saved[0]!.id, tenantId, version, handles, by],
    );
    await client.query('commit');
    return true;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    // outro admin gravou a primeira versão ao mesmo tempo (índice único por cliente, lista e idioma)
    if ((err as { code?: string }).code === '23505') return false;
    throw err;
  } finally {
    client.release();
  }
}

/** Padrão do cliente para as salas (janela, modo lento, rigor, tipos de lance do jogo). `null` volta ao padrão. */
export const saveChatSettingsAction = withStaffAudit(
  'chat.settings',
  async function saveChatSettingsAction(input: {
    openBeforeMinutes: number | null;
    closeAfterMinutes: number | null;
    slowModeSeconds: number | null;
    strictness: 'standard' | 'strict' | null;
    eventKinds: string[] | null;
    floodMaxPerMinute: number | null;
    floodBlockSeconds: number | null;
    /** Perfis oficiais liberados (`@clube`); ausente não muda a lista. */
    allowedHandles?: string[];
  }): Promise<ChatActionResult> {
    const s = await session();
    if ('error' in s) return { ok: false, error: s.error };
    const { ctx, actor, T } = s;
    if (!allowed(ctx, 'settings.manage').ok) return { ok: false, error: T.role };
    if (!hasLiveChat(ctx)) return { ok: false, error: T.role };
    const minutes = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v <= 1440);
    const okSlow =
      input.slowModeSeconds === null ||
      (Number.isInteger(input.slowModeSeconds) && input.slowModeSeconds >= 0 && input.slowModeSeconds <= 600);
    const okStrict =
      input.strictness === null || input.strictness === 'standard' || input.strictness === 'strict';
    const okKinds = input.eventKinds === null || input.eventKinds.every((k) => GAME_KINDS.includes(k));
    const within = (v: number | null, min: number, max: number) =>
      v === null || (Number.isInteger(v) && v >= min && v <= max);
    if (
      !minutes(input.openBeforeMinutes) ||
      !minutes(input.closeAfterMinutes) ||
      !okSlow ||
      !okStrict ||
      !okKinds ||
      !within(input.floodMaxPerMinute, 3, 60) ||
      !within(input.floodBlockSeconds, 30, 1800)
    )
      return { ok: false, error: T.invalid };
    if (
      input.allowedHandles !== undefined &&
      (!Array.isArray(input.allowedHandles) || input.allowedHandles.length > MAX_HANDLES * 2)
    )
      return { ok: false, error: T.invalid };
    const handles =
      input.allowedHandles === undefined
        ? undefined
        : canonicalTerms('allowed_handles', input.allowedHandles);
    if (handles && handles.length > MAX_HANDLES) return { ok: false, error: T.invalid };
    const before = await loadChatSettings(ctx.tenant.id);
    const by = actor.kind === 'galaxie' ? actor.id : `tenant:${actor.id}`;
    await pool.query(
      `insert into chat.tenant_config
       (tenant_id, open_before_minutes, close_after_minutes, slow_mode_seconds, strictness, event_kinds,
        flood_max_per_minute, flood_block_seconds, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (tenant_id) do update set
       open_before_minutes = excluded.open_before_minutes, close_after_minutes = excluded.close_after_minutes,
       slow_mode_seconds = excluded.slow_mode_seconds, strictness = excluded.strictness,
       event_kinds = excluded.event_kinds, flood_max_per_minute = excluded.flood_max_per_minute,
       flood_block_seconds = excluded.flood_block_seconds, updated_by = excluded.updated_by, updated_at = now()`,
      [
        ctx.tenant.id,
        input.openBeforeMinutes,
        input.closeAfterMinutes,
        input.slowModeSeconds,
        input.strictness,
        input.eventKinds ? [...new Set(input.eventKinds)] : null,
        input.floodMaxPerMinute,
        input.floodBlockSeconds,
        by,
      ],
    );
    if (handles && !(await saveTenantHandles(ctx.tenant.id, handles, by)))
      return { ok: false, error: T.invalid };
    try {
      await recordModerationDecision(builderDb(), {
        tenantId: ctx.tenant.id,
        actor,
        action: 'chat.settings',
        clocks: await clocksFor(ctx.tenant.id, null),
        reason: 'chat.settings',
        rules: { before, after: { ...input, ...(handles ? { allowedHandles: handles } : {}) } },
      });
    } catch (err) {
      // sem ficha do país do cliente: o padrão vale (não é decisão sobre torcedor), e fica o registro no log
      console.warn('[chat] auditoria do padrão das salas não gravada', { tenantId: ctx.tenant.id, err });
    }
    return { ok: true };
  },
);
