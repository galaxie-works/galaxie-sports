/**
 * Autenticação da demo (Better Auth): só e-mail e senha, sem cadastro aberto — quem entra foi convidado
 * por um admin. Papéis: `admin` (gerencia usuários) e `user` (convidado, só navega na demo).
 * O convite usa o fluxo de redefinição de senha: o convidado recebe um link e define a própria senha.
 */
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins/admin';

import { pool } from './db';
import { sendAccessEmail } from './email';

/** Validade do link de convite / redefinição (o mesmo token do Better Auth serve aos dois). */
export const ACCESS_LINK_HOURS = 72;

export const ROLE_LABEL: Record<string, string> = { admin: 'Admin', user: 'Convidado' };

/**
 * Último link gerado por usuário quando o e-mail NÃO foi entregue (ex.: sem SMTP), para o admin copiar
 * na hora. Fica só em memória e é consumido uma vez: nunca vai para o banco nem para o cliente sem pedido.
 */
const undeliveredLinks = new Map<string, { url: string; at: number }>();
export function takeUndeliveredLink(userId: string): string | null {
  const hit = undeliveredLinks.get(userId);
  undeliveredLinks.delete(userId);
  return hit && Date.now() - hit.at < 60_000 ? hit.url : null;
}

/** Acesso vencido? Admin nunca expira; sem data = sem prazo. */
export function isAccessExpired(user: { role?: string | null; accessExpiresAt?: Date | string | null }) {
  if (user.role === 'admin' || !user.accessExpiresAt) return false;
  return new Date(user.accessExpiresAt).getTime() < Date.now();
}

export const auth = betterAuth({
  appName: 'Galaxie Sports',
  database: pool,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    resetPasswordTokenExpiresIn: ACCESS_LINK_HOURS * 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Ainda sem senha definida pelo próprio usuário = convite; senão, redefinição.
      const { rows } = await pool.query<{ invited: boolean }>(
        'select password_set_at is null as invited from "user" where id = $1',
        [user.id],
      );
      const kind = rows[0]?.invited ? 'invite' : 'reset';
      const result = await sendAccessEmail({
        kind,
        to: user.email,
        name: user.name,
        url,
        expiresInHours: ACCESS_LINK_HOURS,
      });
      await pool.query('insert into invite (user_id, kind, delivered, error) values ($1, $2, $3, $4)', [
        user.id,
        kind,
        result.delivered,
        result.error ?? null,
      ]);
      if (!result.delivered) undeliveredLinks.set(user.id, { url, at: Date.now() });
    },
    onPasswordReset: async ({ user }) => {
      await pool.query(
        'update "user" set password_set_at = now() where id = $1 and password_set_at is null',
        [user.id],
      );
    },
  },
  user: {
    additionalFields: {
      jobTitle: { type: 'string', required: false, fieldName: 'job_title' },
      company: { type: 'string', required: false },
      phone: { type: 'string', required: false },
      notes: { type: 'string', required: false },
      accessExpiresAt: { type: 'date', required: false, fieldName: 'access_expires_at' },
      passwordSetAt: { type: 'date', required: false, input: false, fieldName: 'password_set_at' },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    // Atrás do Traefik: o IP real do cliente vem no X-Forwarded-For.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const { rows } = await pool.query<{ role: string | null; access_expires_at: Date | null }>(
            'select role, access_expires_at from "user" where id = $1',
            [session.userId],
          );
          const user = rows[0];
          if (user && isAccessExpired({ role: user.role, accessExpiresAt: user.access_expires_at })) {
            throw new APIError('FORBIDDEN', {
              code: 'ACCESS_EXPIRED',
              message: 'Seu acesso à demo expirou. Fale com quem te convidou para renovar.',
            });
          }
          return { data: session };
        },
        after: async (session) => {
          await pool.query(
            `insert into activity (user_id, kind, ip_address, user_agent) values ($1, 'login', $2, $3)`,
            [session.userId, session.ipAddress ?? null, session.userAgent ?? null],
          );
        },
      },
    },
  },
  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
      bannedUserMessage: 'Seu acesso à demo foi desativado. Fale com quem te convidou.',
    }),
    // Precisa ser o último: grava os cookies de sessão quando as ações do servidor chamam a API do auth.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session['user'];
