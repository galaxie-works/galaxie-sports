/**
 * Proteção do login por código contra força bruta, no Postgres da demo (sobrevive a reinício). O limite
 * de 5 tentativas por código não basta: quem pede um código novo a cada 45 s ganha mais 5 chutes, o que
 * dá ~1% de acertar por dia o código de um e-mail conhecido (o do admin, por exemplo).
 *
 * - Pedidos de código (`otp_request`): um a cada 45 s por e-mail (OTP_RESEND_GUARD_SECONDS).
 * - Chutes errados (`otp_failure`), contados numa janela de uma hora:
 *   - por e-mail e IP: OTP_MAX_FAILURES_PER_IP. Quem erra demais trava só a si mesmo, não o dono do
 *     e-mail entrando de outro lugar;
 *   - por e-mail, somando todos os IPs: OTP_MAX_FAILURES_PER_EMAIL, o teto do ataque distribuído.
 *
 * Só conta o erro que vem depois de um pedido de código para aquele e-mail, dentro da validade do código:
 * sem pedido, o Better Auth responde INVALID_OTP sem conferir nada, e contar isso deixaria qualquer um
 * travar um e-mail em silêncio. Para travar alguém, então, é preciso pedir códigos, e cada pedido manda um
 * e-mail ao dono. A regra é a mesma para e-mail que não tem conta (o pedido fica registrado do mesmo
 * jeito), para a resposta não revelar quem tem acesso.
 *
 * O bloqueio dura enquanto houver erros demais na última hora. O admin destrava pelo detalhe do usuário
 * (Ajustes → Usuários → Sessões); se o travado for o próprio admin, pelo comando de
 * docs/runbooks/demo-login.md. Chegar a um dos tetos sai no log como aviso.
 */
import { pool } from './db';
import { indexIfMissing } from './ddl';

/** Janela da contagem de tentativas erradas. */
export const OTP_FAILURE_WINDOW_MINUTES = 60;
/** Chutes errados por e-mail vindos do mesmo IP antes do bloqueio (4 códigos inteiros). */
export const OTP_MAX_FAILURES_PER_IP = 20;
/** Chutes errados por e-mail somando todos os IPs (12 códigos, cada um num e-mail ao dono). */
export const OTP_MAX_FAILURES_PER_EMAIL = 60;
/** Intervalo mínimo entre dois pedidos de código para o mesmo e-mail (a tela espera 60 s). */
export const OTP_RESEND_GUARD_SECONDS = 45;
/** Por quanto tempo depois de um pedido os erros contam: a validade do código (server.ts). */
export const OTP_REQUEST_MINUTES = 10;

/** Tabelas da proteção (criadas na subida, com as outras tabelas próprias: setup.ts). */
export const OTP_GUARD_TABLES = `
create table if not exists otp_failure (
  id bigserial primary key,
  email text not null,
  ip text,
  created_at timestamptz not null default now()
);
${indexIfMissing('otp_failure_email_idx', 'otp_failure (email, created_at desc)')}
${indexIfMissing('otp_failure_created_idx', 'otp_failure (created_at)')}

create table if not exists otp_request (
  id bigserial primary key,
  email text not null,
  created_at timestamptz not null default now()
);
${indexIfMissing('otp_request_email_idx', 'otp_request (email, created_at desc)')}
${indexIfMissing('otp_request_created_idx', 'otp_request (created_at)')}
`;

const within = (minutes: number) => `created_at > now() - make_interval(mins => ${minutes})`;
const IN_WINDOW = within(OTP_FAILURE_WINDOW_MINUTES);

/** Erros na janela: do e-mail inteiro e só do IP. */
async function failures(email: string, ip: string | null): Promise<{ email: number; ip: number }> {
  const { rows } = await pool.query<{ email: number; ip: number }>(
    `select count(*)::int as email,
            (count(*) filter (where ip is not distinct from $2))::int as ip
       from otp_failure where email = $1 and ${IN_WINDOW}`,
    [email, ip],
  );
  return { email: rows[0]?.email ?? 0, ip: rows[0]?.ip ?? 0 };
}

const isOverLimit = (n: { email: number; ip: number }) =>
  n.email >= OTP_MAX_FAILURES_PER_EMAIL || n.ip >= OTP_MAX_FAILURES_PER_IP;

/** O e-mail está bloqueado agora para quem vem deste IP? */
export async function isOtpLocked(email: string, ip: string | null): Promise<boolean> {
  return isOverLimit(await failures(email, ip));
}

/**
 * Registra o pedido de um código, se o último pedido para o e-mail tiver mais de 45 s. Devolve `false`
 * quando é cedo demais (nada é gravado). Uma instrução só, para dois pedidos juntos não passarem os dois.
 */
export async function registerOtpRequest(email: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `insert into otp_request (email)
     select $1 where not exists (
       select 1 from otp_request
        where email = $1 and created_at > now() - make_interval(secs => ${OTP_RESEND_GUARD_SECONDS}))`,
    [email],
  );
  await pool.query(`delete from otp_request where not (${within(OTP_REQUEST_MINUTES)})`);
  return rowCount === 1;
}

/** Houve pedido de código para o e-mail dentro da validade do código? */
export async function hasRecentOtpRequest(email: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from otp_request where email = $1 and ${within(OTP_REQUEST_MINUTES)} limit 1`,
    [email],
  );
  return rows.length > 0;
}

/** Registra um chute errado e devolve se ficou bloqueado; ao chegar a um dos tetos, avisa no log. */
export async function recordOtpFailure(email: string, ip: string | null): Promise<boolean> {
  await pool.query('insert into otp_failure (email, ip) values ($1, $2)', [email, ip]);
  // o que já saiu da janela não serve para nada
  await pool.query(`delete from otp_failure where not (${IN_WINDOW})`);
  const n = await failures(email, ip);
  if (n.ip === OTP_MAX_FAILURES_PER_IP || n.email === OTP_MAX_FAILURES_PER_EMAIL) {
    const scope = n.email >= OTP_MAX_FAILURES_PER_EMAIL ? 'todos os IPs' : `IP ${ip ?? 'desconhecido'}`;
    console.warn(
      `[demo-auth] login por código bloqueado para ${email} (${scope}): ` +
        `${n.email} tentativas erradas na última hora, ${n.ip} deste IP`,
    );
  }
  return isOverLimit(n);
}

/**
 * Zera a contagem: login certo (só a do IP de quem entrou, para o login do dono não apagar os erros do
 * atacante em outro IP) ou desbloqueio pelo admin (`ip` omitido: tudo do e-mail).
 */
export async function clearOtpFailures(email: string, ip?: string | null): Promise<void> {
  if (ip === undefined) await pool.query('delete from otp_failure where email = $1', [email]);
  else {
    await pool.query('delete from otp_failure where email = $1 and ip is not distinct from $2', [email, ip]);
  }
}

/** Resumo para o painel do admin: erros na janela e se algum IP (ou o e-mail todo) está bloqueado. */
export async function otpFailureSummary(email: string): Promise<{ failures: number; locked: boolean }> {
  const { rows } = await pool.query<{ ip: string | null; n: number }>(
    `select ip, count(*)::int as n from otp_failure where email = $1 and ${IN_WINDOW} group by ip`,
    [email],
  );
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  const locked = total >= OTP_MAX_FAILURES_PER_EMAIL || rows.some((r) => r.n >= OTP_MAX_FAILURES_PER_IP);
  return { failures: total, locked };
}
