'use server';

/**
 * Ações do painel do cliente. Cada uma resolve a sessão e o tenant no servidor (`readClientContext`): o
 * tenant nunca vem do navegador, e toda escrita leva o tenant da sessão (um cliente não toca em widget ou
 * chave de outro tenant, nem com um id conhecido).
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import {
  ENTITY_TYPES,
  MAX_ORIGINS,
  NAME_MAX,
  parseBrandThemeName,
  parseOrigins,
  parseTheme,
  parseWidgetInput,
} from '@/lib/builder/config';
import {
  archiveWidget,
  BrandThemeLimitError,
  BrandThemeNameTakenError,
  BrandThemeNotFoundError,
  builderDb,
  deleteWidgetTheme,
  saveWidgetTheme,
  createPublishableKey,
  getWidget,
  normalizeAllowedOrigin,
  originsOutsideEnv,
  PublishableKeyLimitError,
  revokePublishableKey,
  saveWidget,
  type PublishableKeyEnv,
} from '@/lib/builder/store';
import type { BrandThemeItem, Widget, WidgetKind } from '@/lib/builder/types';
import { isStaffRole } from '@/lib/auth/roles';
import { can } from '@/lib/client/permissions';
import { readClientContext, TENANT_COOKIE } from '@/lib/client/session';
import { withStaffAudit } from '@/lib/client/staff';
import { encodeStaffReason, normalizeStaffReason, STAFF_REASON_COOKIE, STAFF_REASON_TTL_S } from '@/lib/client/staff-reason';
import { isUuid } from '@/lib/client/tenants';
import { COOKIE_MAX_AGE } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export interface ClientActionResult {
  ok: boolean;
  error?: string;
}

async function texts() {
  return getDictionary(await getRequestLocale()).client;
}

/**
 * Sessão com tenant e a ação da tela (`keys.manage` para as chaves, `builder.manage` para widgets e temas, #1019 e
 * #1136), ou a mensagem de erro. É integração: Admin, Dono e Desenvolvedor mexem; Moderador e Voluntário, não.
 */
async function tenantOrError(action: 'keys.manage' | 'builder.manage') {
  const ctx = await readClientContext();
  const t = await texts();
  if (!ctx) return { error: t.errors.forbidden } as const;
  if (!ctx.tenant) return { error: t.errors.noTenant } as const;
  if (!can(ctx, action)) return { error: t.errors.role } as const;
  return { ctx, tenant: ctx.tenant } as const;
}

const revalidateClient = () => revalidatePath('/client', 'layout');

/**
 * Qual tenant acompanhar: a equipe, qualquer um; o cliente, entre os em que tem cargo (cookie conferido a cada
 * leitura). A equipe num tenant de cliente informa o motivo (ticket ou pedido do cliente, PL17), que fica num cookie
 * assinado por 8 h e vai em toda escrita para `billing.staff_action`; sem motivo, a troca não acontece. Chamar de novo
 * com o tenant em foco só troca o motivo. Não passa pelo `withStaffAudit`: é a porta que guarda o motivo.
 */
export async function selectTenant(tenantId: string, reason?: string): Promise<ClientActionResult> {
  const ctx = await readClientContext();
  const t = await texts();
  if (!ctx) return { ok: false, error: t.errors.forbidden };
  const target = ctx.tenants.find((x) => x.id === tenantId);
  if (!target) return { ok: false, error: t.errors.noTenant };
  const jar = await cookies();
  if (isStaffRole(ctx.role)) {
    if (target.isGalaxie) jar.delete(STAFF_REASON_COOKIE);
    else {
      const normalized = normalizeStaffReason(reason);
      if (!normalized) return { ok: false, error: t.staff.reasonRequired };
      jar.set(STAFF_REASON_COOKIE, encodeStaffReason(process.env.BETTER_AUTH_SECRET ?? '', { tenantId, reason: normalized }), {
        path: '/',
        maxAge: STAFF_REASON_TTL_S,
        sameSite: 'lax',
        httpOnly: true,
      });
    }
  }
  jar.set(TENANT_COOKIE, tenantId, {
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
  });
  revalidateClient();
  return { ok: true };
}

// ─── chaves publicáveis ──────────────────────────────────────────────────────────────────────────

export interface CreateKeyResult extends ClientActionResult {
  /** A chave inteira: aparece só nesta resposta. */
  key?: string;
}

export const createKey = withStaffAudit('keys.create', async (input: {
  name: string;
  origins: string;
  widgetId: string | null;
  /** `live` (padrão, domínios públicos) ou `test` (gs_pk_test_, só localhost). */
  env?: PublishableKeyEnv;
}): Promise<CreateKeyResult> => {
  const t = await texts();
  const r = await tenantOrError('keys.manage');
  if ('error' in r) return { ok: false, error: r.error };
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name || name.length > NAME_MAX) return { ok: false, error: t.errors.keyName };
  const { origins, invalid } = parseOrigins(input.origins ?? '', normalizeAllowedOrigin);
  if (invalid.length) return { ok: false, error: fill(t.errors.origins, { list: invalid.join(', ') }) };
  if (!origins.length) return { ok: false, error: t.errors.noOrigins };
  if (origins.length > MAX_ORIGINS)
    return { ok: false, error: fill(t.errors.tooManyOrigins, { max: MAX_ORIGINS }) };
  const env: PublishableKeyEnv = input.env === 'test' ? 'test' : 'live';
  const outside = originsOutsideEnv(env, origins);
  if (outside.length)
    return {
      ok: false,
      error: fill(env === 'test' ? t.errors.originsTestOnly : t.errors.originsNoLocalhost, {
        list: outside.join(', '),
      }),
    };
  let widgetId: string | null = null;
  if (input.widgetId) {
    const w = isUuid(input.widgetId) ? await getWidget(builderDb(), input.widgetId) : null;
    if (!w || w.tenantId !== r.tenant.id || w.archivedAt)
      return { ok: false, error: t.errors.widgetNotFound };
    widgetId = w.id;
  }
  try {
    const created = await createPublishableKey(builderDb(), {
      tenantId: r.tenant.id,
      name,
      allowedOrigins: origins,
      widgetId,
      env,
      actor: `panel:${r.ctx.userId}`,
    });
    revalidateClient();
    return { ok: true, key: created.key };
  } catch (err) {
    if (err instanceof PublishableKeyLimitError) return { ok: false, error: t.errors.keyLimit };
    console.error('[cliente] falha ao criar chave publicável', err);
    return { ok: false, error: t.errors.generic };
  }
});

export const revokeKey = withStaffAudit('keys.revoke', async (id: string): Promise<ClientActionResult> => {
  const t = await texts();
  const r = await tenantOrError('keys.manage');
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id) || !(await revokePublishableKey(builderDb(), r.tenant.id, id, `panel:${r.ctx.userId}`)))
    return { ok: false, error: t.errors.keyNotFound };
  revalidateClient();
  return { ok: true };
});

// ─── widgets ─────────────────────────────────────────────────────────────────────────────────────

export interface SaveWidgetResult extends ClientActionResult {
  widget?: Widget;
}

const entityTypesOf = (kind: WidgetKind) => ENTITY_TYPES[kind];

export const saveWidgetAction = withStaffAudit('builder.widget.save', async (input: {
  id: string | null;
  kind: unknown;
  name: unknown;
  config: unknown;
}): Promise<SaveWidgetResult> => {
  const t = await texts();
  const r = await tenantOrError('builder.manage');
  if ('error' in r) return { ok: false, error: r.error };
  const parsed = parseWidgetInput(input, {
    markets: r.tenant.markets,
    entityTypes: entityTypesOf,
    sports: r.tenant.sports,
  });
  if (!parsed.ok) return { ok: false, error: t.errors.widget[parsed.error] };
  if (input.id !== null && !isUuid(input.id)) return { ok: false, error: t.errors.widgetNotFound };
  try {
    // Outro tenant ou widget arquivado: o pacote lança erro (o id do navegador não vale fora do tenant).
    const widget = await saveWidget(builderDb(), {
      tenantId: r.tenant.id,
      ...(input.id ? { id: input.id } : {}),
      ...parsed.value,
      createdBy: r.ctx.userId,
    });
    revalidateClient();
    return { ok: true, widget };
  } catch (err) {
    if (err instanceof BrandThemeNotFoundError) return { ok: false, error: t.errors.widget.brandTheme };
    return { ok: false, error: t.errors.widgetNotFound };
  }
});

export const archiveWidgetAction = withStaffAudit('builder.widget.archive', async (id: string): Promise<ClientActionResult> => {
  const t = await texts();
  const r = await tenantOrError('builder.manage');
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id) || !(await archiveWidget(builderDb(), r.tenant.id, id)))
    return { ok: false, error: t.errors.widgetNotFound };
  revalidateClient();
  return { ok: true };
});

// ─── temas da marca ──────────────────────────────────────────────────────────────────────────────

export interface SaveBrandThemeResult extends ClientActionResult {
  theme?: BrandThemeItem;
  /** Widgets que mudaram junto com o tema. */
  widgetsUpdated?: number;
}

/** Cria (`id` null) ou atualiza um tema da marca; na atualização, os widgets ligados mudam juntos. */
export const saveBrandThemeAction = withStaffAudit('builder.theme.save', async (input: {
  id: string | null;
  name: unknown;
  theme: unknown;
}): Promise<SaveBrandThemeResult> => {
  const t = await texts();
  const r = await tenantOrError('builder.manage');
  if ('error' in r) return { ok: false, error: r.error };
  const name = parseBrandThemeName(input.name);
  if (!name) return { ok: false, error: t.errors.brandThemes.name };
  const theme = parseTheme(input.theme);
  if (!theme) return { ok: false, error: t.errors.widget.theme };
  if (input.id !== null && !isUuid(input.id)) return { ok: false, error: t.errors.brandThemes.notFound };
  try {
    const saved = await saveWidgetTheme(builderDb(), {
      tenantId: r.tenant.id,
      ...(input.id ? { id: input.id } : {}),
      name,
      theme,
      createdBy: r.ctx.userId,
    });
    revalidateClient();
    return {
      ok: true,
      theme: { id: saved.theme.id, name: saved.theme.name, theme: saved.theme.theme, widgetCount: 0 },
      widgetsUpdated: saved.widgetsUpdated,
    };
  } catch (err) {
    if (err instanceof BrandThemeNameTakenError)
      return { ok: false, error: fill(t.errors.brandThemes.nameTaken, { name }) };
    if (err instanceof BrandThemeNotFoundError) return { ok: false, error: t.errors.brandThemes.notFound };
    if (err instanceof BrandThemeLimitError) return { ok: false, error: t.errors.brandThemes.limit };
    console.error('[cliente] falha ao salvar tema da marca', err);
    return { ok: false, error: t.errors.generic };
  }
});

export interface DeleteBrandThemeResult extends ClientActionResult {
  /** Widgets que deixaram de seguir o tema (ficam com o visual que tinham). */
  widgetsUnlinked?: number;
}

export const deleteBrandThemeAction = withStaffAudit('builder.theme.delete', async (id: string): Promise<DeleteBrandThemeResult> => {
  const t = await texts();
  const r = await tenantOrError('builder.manage');
  if ('error' in r) return { ok: false, error: r.error };
  const unlinked = isUuid(id) ? await deleteWidgetTheme(builderDb(), r.tenant.id, id) : null;
  if (unlinked === null) return { ok: false, error: t.errors.brandThemes.notFound };
  revalidateClient();
  return { ok: true, widgetsUnlinked: unlinked };
});
