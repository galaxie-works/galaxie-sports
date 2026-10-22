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
import { auth } from '@/lib/auth/server';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Link da tela de login para copiar, só quando o e-mail não pôde ser enviado (ex.: sem SMTP). */
  link?: string | null;
  emailSent?: boolean;
  userId?: string;
}

export interface ProfileInput {
  name: string;
  jobTitle?: string;
  company?: string;
  phone?: string;
  notes?: string;
}

export interface InviteInput extends ProfileInput {
  email: string;
  role: 'admin' | 'user';
  /** Dias de acesso a partir de hoje; null = sem prazo. */
  accessDays: number | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: string | undefined) => {
  const t = v?.trim();
  return t ? t.slice(0, 200) : null;
};
const expiryFromDays = (days: number | null) =>
  days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();

function message(err: unknown) {
  const e = err as { body?: { message?: string; code?: string }; message?: string };
  if (e?.body?.code === 'USER_ALREADY_EXISTS' || /already exists/i.test(e?.body?.message ?? ''))
    return 'Já existe um usuário com este e-mail.';
  return e?.body?.message ?? e?.message ?? 'Não foi possível concluir a ação.';
}

export async function inviteUser(input: InviteInput): Promise<ActionResult> {
  await requireAdmin();
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Informe o nome.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'E-mail inválido.' };
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
        },
      },
    });
    const userId = created.user.id;
    const sent = await sendInvite(userId);
    revalidatePath('/ajustes/usuarios');
    return { ok: true, userId, ...sent };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function updateProfile(userId: string, input: ProfileInput): Promise<ActionResult> {
  await requireAdmin();
  if (!input.name.trim()) return { ok: false, error: 'Informe o nome.' };
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
        },
      },
    });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    revalidatePath('/ajustes/usuarios');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function updateAccess(
  userId: string,
  input: { role: 'admin' | 'user'; accessExpiresAt: string | null },
): Promise<ActionResult> {
  const me = await requireAdmin();
  if (userId === me.id && input.role !== 'admin')
    return { ok: false, error: 'Você não pode tirar o seu próprio papel de admin.' };
  try {
    const h = await headers();
    await auth.api.setRole({ headers: h, body: { userId, role: input.role } });
    await auth.api.adminUpdateUser({
      headers: h,
      body: { userId, data: { accessExpiresAt: input.role === 'admin' ? null : input.accessExpiresAt } },
    });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    revalidatePath('/ajustes/usuarios');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function resendInvite(userId: string): Promise<ActionResult> {
  await requireAdmin();
  const { rows } = await pool.query<{ id: string }>('select id from "user" where id = $1', [userId]);
  if (!rows[0]) return { ok: false, error: 'Usuário não encontrado.' };
  try {
    const sent = await sendInvite(userId);
    revalidatePath(`/ajustes/usuarios/${userId}`);
    revalidatePath('/ajustes/usuarios');
    return { ok: true, ...sent };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function setDisabled(userId: string, disabled: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  if (userId === me.id) return { ok: false, error: 'Você não pode desativar a sua própria conta.' };
  try {
    const h = await headers();
    if (disabled) await auth.api.banUser({ headers: h, body: { userId, banReason: 'Desativado no painel' } });
    else await auth.api.unbanUser({ headers: h, body: { userId } });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    revalidatePath('/ajustes/usuarios');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function revokeSession(userId: string, sessionToken: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await auth.api.revokeUserSession({ headers: await headers(), body: { sessionToken } });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function revokeAllSessions(userId: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await auth.api.revokeUserSessions({ headers: await headers(), body: { userId } });
    revalidatePath(`/ajustes/usuarios/${userId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function removeUser(userId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (userId === me.id) return { ok: false, error: 'Você não pode remover a sua própria conta.' };
  try {
    await auth.api.removeUser({ headers: await headers(), body: { userId } });
    await pool.query('delete from activity where user_id = $1', [userId]);
    await pool.query('delete from invite where user_id = $1', [userId]);
    revalidatePath('/ajustes/usuarios');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
