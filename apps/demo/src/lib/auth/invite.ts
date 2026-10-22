/**
 * Convite de acesso à demo: um e-mail com o link da tela de login e a validade do acesso. Não há senha
 * nem token no link — para entrar, a pessoa pede um código de acesso no próprio e-mail convidado.
 */
import { pool } from './db';
import { sendAccessEmail } from './email';

/** Endereço público da tela de login (sem o e-mail da pessoa na URL). */
export function loginUrl() {
  const base = process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:3000';
  return new URL('/login', base).toString();
}

export interface InviteResult {
  /** O e-mail saiu? Sem SMTP (ou com falha), o admin recebe o link para mandar por outro canal. */
  emailSent: boolean;
  link: string | null;
}

/** Manda (ou reenvia) o convite e registra o envio na tabela `invite`. */
export async function sendInvite(userId: string): Promise<InviteResult> {
  const { rows } = await pool.query<{ email: string; name: string; access_expires_at: Date | null }>(
    'select email, name, access_expires_at from "user" where id = $1',
    [userId],
  );
  const user = rows[0];
  if (!user) throw new Error('Usuário não encontrado.');
  const url = loginUrl();
  const result = await sendAccessEmail({
    kind: 'invite',
    to: user.email,
    name: user.name,
    url,
    accessExpiresAt: user.access_expires_at,
  });
  await pool.query('insert into invite (user_id, kind, delivered, error) values ($1, $2, $3, $4)', [
    userId,
    'invite',
    result.delivered,
    result.error ?? null,
  ]);
  return { emailSent: result.delivered, link: result.delivered ? null : url };
}
