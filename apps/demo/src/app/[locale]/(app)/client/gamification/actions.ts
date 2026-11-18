'use server';

/**
 * Ações da Gamificação no painel do cliente (#917). O tenant sai sempre da sessão (`readClientContext`), nunca do
 * navegador. Configurar exige `settings.manage` (#1019) e o módulo ligado.
 */
import { ensureGameProgram, setGameAchievementEnabled } from '@galaxie/db/game';
import { DEFAULT_POINTS_SCALE, countryTimeZone } from '@galaxie/game-rules';
import { revalidatePath } from 'next/cache';

import { isStaffRole } from '@/lib/auth/roles';
import { gameDb } from '@/lib/client/gamification';
import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { withStaffAudit } from '@/lib/client/staff';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface GamificationActionResult {
  ok: boolean;
  error?: string;
}

const PATH = '/client/gamification';
const COUNTRY = /^[A-Z]{2}$/;
const ACHIEVEMENT = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

async function context() {
  const dict = getDictionary(await getRequestLocale());
  const t = dict.gamification;
  const ctx = await readClientContext();
  if (!ctx) return { t, error: dict.client.errors.forbidden } as const;
  if (!ctx.tenant) return { t, error: dict.client.errors.noTenant } as const;
  if (!can(ctx, 'settings.manage')) return { t, error: dict.client.errors.role } as const;
  if (!ctx.tenant.modules.includes('gamification')) return { t, error: t.errors.module } as const;
  return {
    t,
    tenantId: ctx.tenant.id,
    actor: isStaffRole(ctx.role) ? `galaxie:${ctx.userId}` : `panel:${ctx.userId}`,
  } as const;
}

/** Ativa o programa do país, com a escala de Pontos da Galaxie em vigor. */
export const activateProgramAction = withStaffAudit(
  'gamification.program.activate',
  async (input: { country: string }): Promise<GamificationActionResult> => {
    const c = await context();
    if ('error' in c) return { ok: false, error: c.error };
    const country = String(input.country ?? '').toUpperCase();
    if (!COUNTRY.test(country)) return { ok: false, error: c.t.errors.country };
    try {
      await ensureGameProgram(gameDb(), {
        tenantId: c.tenantId,
        programCountry: country,
        timeZone: countryTimeZone(country),
        rules: { scale: { ...DEFAULT_POINTS_SCALE } },
        changedBy: c.actor,
      });
    } catch (err) {
      console.error('[gamificação] ativar programa falhou', err);
      return { ok: false, error: c.t.errors.generic };
    }
    revalidatePath(PATH);
    return { ok: true };
  },
);

/** Liga ou desliga uma Conquista do Catálogo no programa do país. */
export const setAchievementEnabledAction = withStaffAudit(
  'gamification.achievement.toggle',
  async (input: {
    country: string;
    achievementId: string;
    enabled: boolean;
  }): Promise<GamificationActionResult> => {
    const c = await context();
    if ('error' in c) return { ok: false, error: c.error };
    const country = String(input.country ?? '').toUpperCase();
    if (!COUNTRY.test(country) || !ACHIEVEMENT.test(String(input.achievementId ?? '')))
      return { ok: false, error: c.t.errors.notFound };
    try {
      const ok = await setGameAchievementEnabled(gameDb(), {
        tenantId: c.tenantId,
        programCountry: country,
        achievementId: input.achievementId,
        enabled: input.enabled === true,
        changedBy: c.actor,
      });
      if (!ok) return { ok: false, error: c.t.errors.notFound };
    } catch (err) {
      console.error('[gamificação] ligar ou desligar Conquista falhou', err);
      return { ok: false, error: c.t.errors.generic };
    }
    revalidatePath(PATH);
    return { ok: true };
  },
);
