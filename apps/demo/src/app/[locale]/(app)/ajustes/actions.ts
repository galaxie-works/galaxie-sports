'use server';

/**
 * Ações do painel de usuários. Cada uma revalida a sessão de admin no servidor (o proxy é só a primeira
 * barreira) e chama a API do Better Auth com os headers do admin, para o plugin conferir a permissão.
 */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requireAdmin } from '@/lib/auth/admin';
import { pool } from '@/lib/auth/db';
import { sendInvite } from '@/lib/auth/invite';
import { isRole, needsTenant, type Role } from '@/lib/auth/roles';
import { auth } from '@/lib/auth/server';
import { tenantExists } from '@/lib/client/tenants';
import { isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary, type Dictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { getTenantOperator, lineupDb } from '@/lib/lineup/store';
import { emailMatchesDomains } from '@/lib/lineup/types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Link da tela de login para copiar, só quando o e-mail não pôde ser enviado (ex.: sem SMTP). */
  link?: string | null;
  emailSent?: boolean;
  userId?: string;
  /** Convite de cliente recusado só por falta de confirmar o e-mail fora dos domínios da operadora. */
  outsideDomain?: boolean;
}

export interface ProfileInput {
  name: string;
  jobTitle?: string;
  company?: string;
  phone?: string;
  notes?: string;
  /** Idioma preferido (o dos e-mails de convite). Ausente = não mexe; null = limpa. */
  locale?: Locale | null;
}

export interface InviteInput extends ProfileInput {
  email: string;
  role: Role;
  /** Tenant da API: obrigatório no papel `client`, ignorado nos outros. */
  tenantId?: string | null;
  /** Dias de acesso a partir de hoje; null = sem prazo. */
  accessDays: number | null;
  /** Idioma do convite (e dos próximos e-mails da pessoa). */
  locale: Locale;
  /**
   * Cliente com e-mail fora dos domínios da operadora do tenant (agência, consultor): o admin viu o aviso
   * e confirmou. Sem a confirmação, o convite volta com o aviso.
   */
  confirmOutsideDomain?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: string | undefined) => {
  const t = v?.trim();
  return t ? t.slice(0, 200) : null;
};
const expiryFromDays = (days: number | null) =>
  days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();

/** Textos no idioma da requisição (Server Actions não têm o parâmetro `[locale]`: vale o cookie). */
async function texts() {
  const dict = getDictionary(await getRequestLocale());
  return { errors: dict.admin.errors, unknown: dict.common.unknownError };
}

async function message(err: unknown) {
  const { errors, unknown } = await texts();
  const e = err as { body?: { message?: string; code?: string }; message?: string };
  if (e?.body?.code === 'USER_ALREADY_EXISTS' || /already exists/i.test(e?.body?.message ?? ''))
    return errors.userExists;
  return e?.body?.message ?? e?.message ?? unknown;
}

const fail = async (key: keyof Dictionary['admin']['errors']): Promise<ActionResult> => ({
  ok: false,
  error: (await texts()).errors[key],
});

/** Tenant que fica gravado no usuário: o do cliente (conferido no banco) ou nenhum. */
async function tenantFor(
  role: Role,
  tenantId: string | null | undefined,
): Promise<{ tenantId: string | null } | { error: 'tenantRequired' }> {
  if (!needsTenant(role)) return { tenantId: null };
  if (!tenantId || !(await tenantExists(tenantId))) return { error: 'tenantRequired' as const };
  return { tenantId };
}

export async function inviteUser(input: InviteInput): Promise<ActionResult> {
  await requireAdmin();
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name) return fail('nameRequired');
  if (!EMAIL_RE.test(email)) return fail('invalidEmail');
  if (!isRole(input.role)) return fail('invalidRole');
  const tenant = await tenantFor(input.role, input.tenantId);
  if ('error' in tenant) return fail(tenant.error);
  if (tenant.tenantId && !input.confirmOutsideDomain) {
    // Aviso, não bloqueio: fora dos domínios da operadora, o convite só sai com a confirmação do admin.
    const operator = await getTenantOperator(lineupDb(), tenant.tenantId);
    if (!emailMatchesDomains(email, operator?.emailDomains ?? []))
      return {
        ok: false,
        outsideDomain: true,
        error: getDictionary(await getRequestLocale()).lineup.errors.outsideDomain,
      };
  }
  try {
    const created = await auth.api.createUser({
      headers: await headers(),
      body: {
        email,
        name,
        role: input.role,
        // Sem senha: a pessoa entra com o código enviado ao e-mail.
        data: {
          jobTitle: clean(input.jobTitle),
          company: clean(input.company),
          phone: clean(input.phone),
          notes: clean(input.notes),
          accessExpiresAt: input.role === 'admin' ? null : expiryFromDays(input.accessDays),
          locale: isLocale(input.locale) ? input.locale : null,
          tenantId: tenant.tenantId,
        },
      },
    });
    const userId = created.user.id;
    const sent = await sendInvite(userId);
    revalidatePath('/ajustes/usuarios');
    return { ok: true, userId, ...sent };
  } catch (err) {
    return { ok: false, error: await message(err) };
  }
}

export async function updateProfile(userId: string, input: ProfileInput): Promise<ActionResult> {
  await requireAdmin();
  if (!input.name.trim()) return fail('nameRequired');
  try {
    await auth.api.adminUpdateUser({
      headers: await headers(),
      body: {
        userId,
        data: {
          name: input.name.trim(),
          jobTitle: clean(input.jobTitle),
          company: clean(input.company),
          phone: clean(input.phone),
          notes: clean(input.notes),
          ...(input.locale === undefined ? {} : { locale: isLocale(input.locale) ? input.locale : null }),
        },
      },
    });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    revalidatePath('/ajustes/usuarios');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: await message(err) };
  }
}

export async function updateAccess(
  userId: string,
  input: { role: Role; accessExpiresAt: string | null; tenantId?: string | null },
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!isRole(input.role)) return fail('invalidRole');
  if (userId === me.id && input.role !== 'admin') return fail('selfDemote');
  const tenant = await tenantFor(input.role, input.tenantId);
  if ('error' in tenant) return fail(tenant.error);
  try {
    const h = await headers();
    await auth.api.setRole({ headers: h, body: { userId, role: input.role } });
    await auth.api.adminUpdateUser({
      headers: h,
      body: {
        userId,
        data: {
          accessExpiresAt: input.role === 'admin' ? null : input.accessExpiresAt,
          tenantId: tenant.tenantId,
        },
      },
    });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    revalidatePath('/ajustes/usuarios');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: await message(err) };
  }
}

export async function resendInvite(userId: string): Promise<ActionResult> {
  await requireAdmin();
  const { rows } = await pool.query<{ id: string }>('select id from "user" where id = $1', [userId]);
  if (!rows[0]) return fail('notFound');
  try {
    const sent = await sendInvite(userId);
    revalidatePath(`/ajustes/usuarios/${userId}`);
    revalidatePath('/ajustes/usuarios');
    return { ok: true, ...sent };
  } catch (err) {
    return { ok: false, error: await message(err) };
  }
}

export async function setDisabled(userId: string, disabled: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  if (userId === me.id) return fail('selfDisable');
  try {
    const h = await headers();
    if (disabled) await auth.api.banUser({ headers: h, body: { userId, banReason: 'Desativado no painel' } });
    else await auth.api.unbanUser({ headers: h, body: { userId } });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    revalidatePath('/ajustes/usuarios');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: await message(err) };
  }
}

export async function revokeSession(userId: string, sessionToken: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await auth.api.revokeUserSession({ headers: await headers(), body: { sessionToken } });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: await message(err) };
  }
}

export async function revokeAllSessions(userId: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await auth.api.revokeUserSessions({ headers: await headers(), body: { userId } });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: await message(err) };
  }
}

export async function removeUser(userId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (userId === me.id) return fail('selfRemove');
  try {
    await auth.api.removeUser({ headers: await headers(), body: { userId } });
    await pool.query('delete from activity where user_id = $1', [userId]);
    await pool.query('delete from invite where user_id = $1', [userId]);
    revalidatePath('/ajustes/usuarios');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: await message(err) };
  }
}
