'use server';

/**
 * Ações das Comunidades no painel do cliente (#939). O tenant sai sempre da sessão (`readClientContext`), nunca do
 * navegador. Configurar exige `settings.manage` (#1019); suspender é só da equipe da Galaxie.
 */
import {
  COMMUNITY_SCOPE_KINDS,
  CommunityError,
  addScopeRule,
  createInvite,
  decideJoinRequest,
  publishTerms,
  removeScopeRule,
  setCommunitySuspended,
  updateCommunityConfig,
  type CommunityScopeKind,
  type CommunitySyncResult,
} from '@galaxie/db/community';
import { validateCommunityConfig, validateCommunityTerms } from '@galaxie/engage';
import { revalidatePath } from 'next/cache';

import { communityDb } from '@/lib/client/communities';
import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { isUuid } from '@/lib/client/tenants';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface CommunityActionResult {
  ok: boolean;
  error?: string;
  /** Escopo: quantas foram criadas, arquivadas e reativadas, e quantas ficaram de fora pelo teto. */
  sync?: { created: number; archived: number; reactivated: number; overLimit: number };
  /** Convite: o código sai só aqui. */
  code?: string;
}

const PATH = '/client/communities';

async function context(opts: { galaxie?: boolean } = {}) {
  const dict = getDictionary(await getRequestLocale());
  const t = dict.communities;
  const ctx = await readClientContext();
  if (!ctx) return { t, error: dict.client.errors.forbidden } as const;
  if (!ctx.tenant) return { t, error: dict.client.errors.noTenant } as const;
  if (opts.galaxie ? ctx.role !== 'admin' : !can(ctx, 'settings.manage'))
    return { t, error: dict.client.errors.role } as const;
  if (!ctx.tenant.modules.includes('communities')) return { t, error: t.errors.module } as const;
  return {
    t,
    tenantId: ctx.tenant.id,
    actor: ctx.role === 'admin' ? `galaxie:${ctx.userId}` : `panel:${ctx.userId}`,
  } as const;
}

type Ctx = Awaited<ReturnType<typeof context>>;

function failure(err: unknown, t: Ctx['t']): CommunityActionResult {
  if (err instanceof CommunityError) return { ok: false, error: t.errors[err.code] };
  console.error('[comunidades] ação do painel falhou', err);
  return { ok: false, error: t.errors.generic };
}

const syncView = (r: CommunitySyncResult) => ({
  created: r.created,
  archived: r.archived,
  reactivated: r.reactivated,
  overLimit: r.overLimit.length,
});

/** Liga uma regra de escopo: as Comunidades nascem na hora, dentro do teto do tenant. */
export async function addScopeRuleAction(input: {
  kind: string;
  target: string;
}): Promise<CommunityActionResult> {
  const c = await context();
  if ('error' in c) return { ok: false, error: c.error };
  if (!(COMMUNITY_SCOPE_KINDS as readonly string[]).includes(input.kind) || typeof input.target !== 'string')
    return { ok: false, error: c.t.errors.invalid_target };
  try {
    const r = await addScopeRule(communityDb(), {
      tenantId: c.tenantId,
      kind: input.kind as CommunityScopeKind,
      target: input.target.trim().slice(0, 80),
      actor: c.actor,
    });
    revalidatePath(PATH);
    return { ok: true, sync: syncView(r) };
  } catch (err) {
    return failure(err, c.t);
  }
}

/** Desliga uma regra: as Comunidades que só ela sustentava são arquivadas, sem apagar nada. */
export async function removeScopeRuleAction(input: { id: string }): Promise<CommunityActionResult> {
  const c = await context();
  if ('error' in c) return { ok: false, error: c.error };
  if (!isUuid(input.id)) return { ok: false, error: c.t.errors.not_found };
  try {
    const r = await removeScopeRule(communityDb(), {
      tenantId: c.tenantId,
      ruleId: input.id,
      actor: c.actor,
    });
    revalidatePath(PATH);
    return { ok: true, sync: syncView(r) };
  } catch (err) {
    return failure(err, c.t);
  }
}

/** Modo de entrada, post de membro, Chat da Comunidade e janela de exibição, com versão otimista. */
export async function saveCommunityConfigAction(input: {
  id: string;
  version: number;
  joinMode?: unknown;
  memberPosts?: unknown;
  chatEnabled?: unknown;
  historyDays?: unknown;
}): Promise<CommunityActionResult> {
  const c = await context();
  if ('error' in c) return { ok: false, error: c.error };
  if (!isUuid(input.id) || !Number.isInteger(input.version))
    return { ok: false, error: c.t.errors.not_found };
  const v = validateCommunityConfig({
    joinMode: input.joinMode,
    memberPosts: input.memberPosts,
    chatEnabled: input.chatEnabled,
    historyDays: input.historyDays,
  });
  if (!v.ok) return { ok: false, error: c.t.errors.invalid };
  try {
    await updateCommunityConfig(communityDb(), {
      tenantId: c.tenantId,
      id: input.id,
      expectedVersion: input.version,
      patch: v.patch,
    });
  } catch (err) {
    return failure(err, c.t);
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Publica uma versão nova dos termos (os três idiomas). Os membros aceitam de novo antes de escrever. */
export async function publishTermsAction(input: {
  id: string;
  body: { pt?: unknown; es?: unknown; en?: unknown };
}): Promise<CommunityActionResult> {
  const c = await context();
  if ('error' in c) return { ok: false, error: c.error };
  if (!isUuid(input.id)) return { ok: false, error: c.t.errors.not_found };
  const v = validateCommunityTerms(input.body);
  if (!v.ok) return { ok: false, error: c.t.errors.terms };
  try {
    await publishTerms(communityDb(), {
      tenantId: c.tenantId,
      communityId: input.id,
      body: v.body,
      actor: c.actor,
    });
  } catch (err) {
    return failure(err, c.t);
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Cria um convite (entrada fechada ou para pular a aprovação). O código aparece uma vez. */
export async function createInviteAction(input: {
  id: string;
  maxUses: number | null;
  days: number | null;
}): Promise<CommunityActionResult> {
  const c = await context();
  if ('error' in c) return { ok: false, error: c.error };
  if (!isUuid(input.id)) return { ok: false, error: c.t.errors.not_found };
  const maxUses =
    input.maxUses === null
      ? null
      : Number.isInteger(input.maxUses)
        ? Math.min(Math.max(input.maxUses, 1), 100_000)
        : 1;
  const days =
    input.days === null ? null : Number.isInteger(input.days) ? Math.min(Math.max(input.days, 1), 365) : 7;
  try {
    const inv = await createInvite(communityDb(), {
      tenantId: c.tenantId,
      communityId: input.id,
      actor: c.actor,
      maxUses,
      expiresAt: days === null ? null : new Date(Date.now() + days * 86_400_000),
    });
    return { ok: true, code: inv.code };
  } catch (err) {
    return failure(err, c.t);
  }
}

/** Aprova ou recusa um pedido de entrada. */
export async function decideJoinRequestAction(input: {
  id: string;
  approve: boolean;
}): Promise<CommunityActionResult> {
  const c = await context();
  if ('error' in c) return { ok: false, error: c.error };
  if (!isUuid(input.id)) return { ok: false, error: c.t.errors.not_found };
  const ok = await decideJoinRequest(communityDb(), {
    tenantId: c.tenantId,
    requestId: input.id,
    approve: input.approve === true,
    actor: c.actor,
    now: new Date(),
  });
  revalidatePath(PATH);
  return ok ? { ok: true } : { ok: false, error: c.t.errors.not_found };
}

/** Suspende ou reativa uma Comunidade: só a equipe da Galaxie. */
export async function suspendCommunityAction(input: {
  id: string;
  suspended: boolean;
}): Promise<CommunityActionResult> {
  const c = await context({ galaxie: true });
  if ('error' in c) return { ok: false, error: c.error };
  if (!isUuid(input.id)) return { ok: false, error: c.t.errors.not_found };
  try {
    await setCommunitySuspended(communityDb(), {
      tenantId: c.tenantId,
      id: input.id,
      suspended: input.suspended === true,
      actor: c.actor,
    });
  } catch (err) {
    return failure(err, c.t);
  }
  revalidatePath(PATH);
  return { ok: true };
}
