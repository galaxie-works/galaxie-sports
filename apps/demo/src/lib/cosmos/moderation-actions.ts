'use server';

/**
 * Salvar a configuração da moderação da Cosmos (#997) e tirar exceções. O tenant e o cargo saem da sessão, nunca do
 * navegador; o teto da Galaxie é relido aqui, e o pacote valida tudo de novo (suspensão ou banimento automáticos e
 * degrau acima do teto são recusados mesmo com payload forjado).
 */
import {
  isCosmosError,
  readModerationCeiling,
  removeModerationOverride,
  saveModerationConfig,
  TENANT_SCOPE,
  type ModerationScope,
} from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';
import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

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
