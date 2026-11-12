'use server';

/**
 * Salvar a configuração da moderação da Cosmos (#997) e tirar exceções. O tenant e o cargo saem da sessão, nunca do
 * navegador; o teto da Galaxie é relido aqui, e o pacote valida tudo de novo (suspensão ou banimento automáticos e
 * degrau acima do teto são recusados mesmo com payload forjado).
 */
import {
  CONTENT_KINDS,
  isCosmosError,
  previewModeration,
  readModerationCeiling,
  removeModerationOverride,
  saveModerationConfig,
  TENANT_SCOPE,
  type ContentKind,
  type ModerationPreview,
  type ModerationScope,
} from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import { can } from '@/lib/client/permissions';
import { allowPreview } from '@/lib/cosmos/assistant-limits';
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { compiledTenantLists } from '@/lib/engage/moderation-lists';

import { PREVIEW_MAX } from './moderation-utils';

export interface ModerationActionResult {
  ok: boolean;
  version?: number;
  error?: string;
  /** Outra pessoa salvou antes: a tela recarrega. */
  conflict?: boolean;
}

async function gate() {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const t = getDictionary(locale).cosmos.moderation;
  // mudar regras e réguas é configuração do cliente (#1019): Admin e Dono, ou quem o Dono liberar
  if (!ctx?.tenant || !ctx.actor || !can(ctx, 'settings.manage')) return { error: t.forbidden } as const;
  return { ctx: { ...ctx, tenant: ctx.tenant }, t } as const;
}

type Texts = ReturnType<typeof getDictionary>['cosmos']['moderation'];

function failure(err: unknown, T: Texts): ModerationActionResult {
  if (isCosmosError(err) && err.code === 'version_conflict')
    return { ok: false, conflict: true, error: T.conflict };
  if (isCosmosError(err) && err.code === 'invalid_moderation_config') return { ok: false, error: T.invalid };
  console.error('[cosmos] moderação não salvou', err);
  return { ok: false, error: T.generic };
}

export async function saveCosmosModeration(
  config: unknown,
  expectedVersion: number,
): Promise<ModerationActionResult> {
  const g = await gate();
  if ('error' in g) return { ok: false, error: g.error };
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return { ok: false, error: g.t.invalid };
  try {
    const db = builderDb();
    const { version } = await saveModerationConfig(db, {
      tenantId: g.ctx.tenant.id,
      scope: TENANT_SCOPE,
      config,
      expectedVersion,
      userId: g.ctx.userId,
      ceiling: await readModerationCeiling(db),
    });
    return { ok: true, version };
  } catch (err) {
    return failure(err, g.t);
  }
}

export async function removeCosmosModerationOverride(
  scope: ModerationScope,
  expectedVersion: number,
): Promise<ModerationActionResult> {
  const g = await gate();
  if ('error' in g) return { ok: false, error: g.error };
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return { ok: false, error: g.t.invalid };
  try {
    await removeModerationOverride(builderDb(), {
      tenantId: g.ctx.tenant.id,
      scope,
      expectedVersion,
      userId: g.ctx.userId,
    });
    return { ok: true };
  } catch (err) {
    return failure(err, g.t);
  }
}

export type PreviewActionResult = { ok: true; preview: ModerationPreview } | { ok: false; error: string };

/**
 * "Testar com uma mensagem" (#999): o que as regras e a Cosmos fariam, pela configuração da sala ou do cliente. Gasta
 * créditos como uso normal e não grava na fila nem no histórico. Quem testa é quem configura (`settings.manage`).
 */
export async function previewCosmosModeration(input: {
  text: string;
  kind: string;
  room?: string;
}): Promise<PreviewActionResult> {
  const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
  const T = getDictionary(locale).moderation.preview.errors;
  if (!ctx?.tenant || !ctx.actor || !can(ctx, 'settings.manage')) return { ok: false, error: T.forbidden };
  if (!allowPreview(ctx.userId)) return { ok: false, error: T.rateLimited };
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return { ok: false, error: T.empty };
  if ([...text].length > PREVIEW_MAX) return { ok: false, error: fill(T.tooLong, { max: PREVIEW_MAX }) };
  const kind = (CONTENT_KINDS as readonly string[]).includes(input.kind) ? (input.kind as ContentKind) : null;
  if (!kind) return { ok: false, error: T.generic };
  const room = typeof input.room === 'string' ? input.room.trim().slice(0, 200) || null : null;
  try {
    const preview = await previewModeration(
      builderDb(),
      {
        tenantId: ctx.tenant.id,
        text,
        kind,
        // o chat é o lugar da sala; o resto segue a configuração das comunidades
        module: kind === 'chat_message' ? 'chat' : 'communities',
        ...(room ? (kind === 'chat_message' ? { room } : { community: room }) : {}),
        locale,
      },
      await compiledTenantLists(ctx.tenant.id),
    );
    return { ok: true, preview };
  } catch (err) {
    console.error('[cosmos] teste da moderação falhou', { tenantId: ctx.tenant.id, err });
    return { ok: false, error: T.generic };
  }
}
