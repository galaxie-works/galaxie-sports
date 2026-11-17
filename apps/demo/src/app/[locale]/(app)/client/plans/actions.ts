'use server';

/**
 * Ações da loja de features (Planos e módulos; plataforma comercial F3, decisão 9 do brief; doc 01 §A loja de
 * features; PL3). O tenant sai sempre da sessão (`readClientContext`), nunca do navegador. "Ativar teste de N dias"
 * liga um módulo em teste pela loja: quem contrata (`canContractModules`: Dono, Admin com `settings.manage`, equipe
 * com motivo), com a conta com acesso (nem `pending_review` nem os estados sem acesso), só o que a loja oferece
 * (`storeView` → `available` com teste ainda não usado na organização). A gravação é de `startModuleTrial`
 * (`@galaxie/billing`): registro, `module_grant` e faixas mínimas numa transação, uma vez por organização e módulo,
 * evento `tenant.module_trial_started`. A demo não tem o cache de direitos do Valkey: a API vê o módulo em até 60 s.
 */
import { revalidatePath } from 'next/cache';

import { canStartModuleTrial, ModuleTrialError, startModuleTrial, stateHasAccess } from '@galaxie/billing';

import { isStaffRole } from '@/lib/auth/roles';
import { builderDb } from '@/lib/builder/store';
import { catalog, getTenantPlanStore } from '@/lib/client/entitlements';
import { canContractModules } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { withStaffAudit } from '@/lib/client/staff';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface ModuleTrialActionResult {
  ok: boolean;
  error?: string;
  /** Fim do teste (ISO 8601) quando `ok`. */
  endsAt?: string;
}

const PATHS = ['/client/plans', '/client'];

/** Liga o teste do módulo para a marca em foco. */
export const startModuleTrialAction = withStaffAudit(
  'plans.module_trial',
  async (input: { module: string }): Promise<ModuleTrialActionResult> => {
    const [ctx, locale] = await Promise.all([readClientContext(), getRequestLocale()]);
    const dict = getDictionary(locale).client;
    const p = dict.planStore;
    const fail = (error: string): ModuleTrialActionResult => ({ ok: false, error });
    if (!ctx) return fail(dict.errors.forbidden);
    if (!ctx.tenant) return fail(dict.errors.noTenant);
    if (!canContractModules(ctx)) return fail(dict.errors.role);
    const tenant = ctx.tenant;
    // sem acesso (teste vencido, suspensa, cancelada, em revisão): nada se contrata até regularizar
    if (!stateHasAccess(tenant.state)) return fail(p.errors.noAccess);
    if (!tenant.organizationId) return fail(p.errors.noOrganization);

    const module = String(input?.module ?? '');
    const store = await getTenantPlanStore(tenant.id);
    if (!store) return fail(p.unavailable);
    const item = store.items.find((i) => i.module === module);
    if (!item || !canStartModuleTrial(item)) return fail(p.errors.notAvailable);

    const actor = isStaffRole(ctx.role) ? `galaxie:${ctx.userId}` : `panel:${ctx.userId}`;
    try {
      const started = await startModuleTrial(builderDb(), catalog(), {
        tenantId: tenant.id,
        organizationId: tenant.organizationId,
        module,
        actor,
      });
      for (const path of PATHS) revalidatePath(path);
      return { ok: true, endsAt: started.endsAt.toISOString() };
    } catch (err) {
      if (err instanceof ModuleTrialError) return fail(p.errors[err.code]);
      console.error('[planos] não foi possível ativar o teste do módulo', err);
      return fail(dict.errors.generic);
    }
  },
);
