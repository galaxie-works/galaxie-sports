/**
 * Bloqueio temporário do login por código contra força bruta. O limite de 5 tentativas por código não
 * basta: quem pede um código novo a cada 45 s ganha mais 5 chutes, o que dá ~1% de acertar por dia o
 * código de um e-mail conhecido (o do admin, por exemplo). Aqui conta toda tentativa errada por e-mail,
 * de qualquer código, numa janela de uma hora, no Postgres da demo (sobrevive a reinício): passou de
 * OTP_MAX_FAILURES, o e-mail não pede nem confere código até as tentativas mais antigas saírem da janela.
 *
 * O bloqueio é sempre temporário (no máximo uma hora depois da última leva de erros), para não travar de
 * vez o admin legítimo; quem insiste em errar só o prolonga. Vale para qualquer e-mail, exista a conta ou
 * não, como o resto do login: a resposta não revela quem tem acesso.
 */
import { pool } from './db';

/** Janela da contagem de tentativas erradas por e-mail. */
export const OTP_FAILURE_WINDOW_MINUTES = 60;
/** Tentativas erradas por e-mail na janela antes do bloqueio (4 códigos inteiros). */
export const OTP_MAX_FAILURES = 20;

/** Erros do Better Auth ao conferir o código que contam como tentativa errada. */
export const OTP_FAILURE_CODES: ReadonlySet<string> = new Set([
  'INVALID_OTP',
  'TOO_MANY_ATTEMPTS',
  'OTP_EXPIRED',
]);

/** Tabela das tentativas erradas (criada na subida, com as outras tabelas próprias: setup.ts). */
export const OTP_FAILURE_TABLE = `
create table if not exists otp_failure (
  id bigserial primary key,
  email text not null,
  created_at timestamptz not null default now()
);
create index if not exists otp_failure_email_idx on otp_failure (email, created_at desc);
`;

const failuresInWindow = async (email: string) => {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from otp_failure
      where email = $1 and created_at > now() - make_interval(mins => $2)`,
    [email, OTP_FAILURE_WINDOW_MINUTES],
  );
  return rows[0]?.n ?? 0;
};

/** O e-mail está bloqueado agora? */
export async function isOtpLocked(email: string): Promise<boolean> {
  return (await failuresInWindow(email)) >= OTP_MAX_FAILURES;
}

/**
 * Registra uma tentativa errada e devolve se o e-mail ficou bloqueado. Ao chegar ao limite, avisa no log
 * (é o alerta: tentativa de força bruta ou alguém perdido no próprio e-mail).
 */
export async function recordOtpFailure(email: string): Promise<boolean> {
  await pool.query('insert into otp_failure (email) values ($1)', [email]);
  // o que já saiu da janela não serve para nada
  await pool.query(`delete from otp_failure where created_at < now() - make_interval(mins => $1)`, [
    OTP_FAILURE_WINDOW_MINUTES,
  ]);
  const failures = await failuresInWindow(email);
  if (failures === OTP_MAX_FAILURES) {
    console.warn(
      `[demo-auth] login por código bloqueado para ${email}: ${failures} tentativas erradas na última hora`,
    );
  }
  return failures >= OTP_MAX_FAILURES;
}

/** Login certo: zera a contagem do e-mail. */
export async function clearOtpFailures(email: string): Promise<void> {
  await pool.query('delete from otp_failure where email = $1', [email]);
}
