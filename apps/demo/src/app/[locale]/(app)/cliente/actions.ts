'use server';

/**
 * Ações do painel do cliente. Cada uma resolve a sessão e o tenant no servidor (`readClientContext`): o
 * tenant nunca vem do navegador, e toda escrita leva o tenant da sessão (um cliente não toca em widget ou
 * chave de outro tenant, nem com um id conhecido).
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { ENTITY_TYPES, MAX_ORIGINS, NAME_MAX, parseOrigins, parseWidgetInput } from '@/lib/builder/config';
import {
  archiveWidget,
  builderDb,
  createPublishableKey,
  getWidget,
  normalizeAllowedOrigin,
  originsOutsideEnv,
  PublishableKeyLimitError,
  revokePublishableKey,
  saveWidget,
  type PublishableKeyEnv,
} from '@/lib/builder/store';
import type { Widget, WidgetKind } from '@/lib/builder/types';
import { readClientContext, TENANT_COOKIE } from '@/lib/client/session';
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

/** Sessão com tenant, ou a mensagem de erro (sem acesso / sem tenant). */
async function tenantOrError() {
  const ctx = await readClientContext();
  const t = await texts();
  if (!ctx) return { error: t.errors.forbidden } as const;
  if (!ctx.tenant) return { error: t.errors.noTenant } as const;
  return { ctx, tenant: ctx.tenant } as const;
}

const revalidateClient = () => revalidatePath('/cliente', 'layout');

/** Admin escolhe qual tenant acompanhar (cookie conferido a cada leitura). */
export async function selectTenant(tenantId: string): Promise<ClientActionResult> {
  const ctx = await readClientContext();
  const t = await texts();
  if (!ctx || ctx.role !== 'admin') return { ok: false, error: t.errors.forbidden };
  if (!ctx.tenants.some((x) => x.id === tenantId)) return { ok: false, error: t.errors.noTenant };
  (await cookies()).set(TENANT_COOKIE, tenantId, {
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

export async function createKey(input: {
  name: string;
  origins: string;
  widgetId: string | null;
  /** `live` (padrão, domínios públicos) ou `test` (gs_pk_test_, só localhost). */
  env?: PublishableKeyEnv;
}): Promise<CreateKeyResult> {
  const t = await texts();
  const r = await tenantOrError();
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
}

export async function revokeKey(id: string): Promise<ClientActionResult> {
  const t = await texts();
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id) || !(await revokePublishableKey(builderDb(), r.tenant.id, id, `panel:${r.ctx.userId}`)))
    return { ok: false, error: t.errors.keyNotFound };
  revalidateClient();
  return { ok: true };
}

// ─── widgets ─────────────────────────────────────────────────────────────────────────────────────

export interface SaveWidgetResult extends ClientActionResult {
  widget?: Widget;
}

const entityTypesOf = (kind: WidgetKind) => ENTITY_TYPES[kind];

export async function saveWidgetAction(input: {
  id: string | null;
  kind: unknown;
  name: unknown;
  config: unknown;
}): Promise<SaveWidgetResult> {
  const t = await texts();
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  const parsed = parseWidgetInput(input, { markets: r.tenant.markets, entityTypes: entityTypesOf });
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
  } catch {
    return { ok: false, error: t.errors.widgetNotFound };
  }
}

export async function archiveWidgetAction(id: string): Promise<ClientActionResult> {
  const t = await texts();
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  if (!isUuid(id) || !(await archiveWidget(builderDb(), r.tenant.id, id)))
    return { ok: false, error: t.errors.widgetNotFound };
  revalidateClient();
  return { ok: true };
}
