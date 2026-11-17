/**
 * Transporte de e-mail do worker (plataforma comercial F3, decisão 11): nodemailer com as mesmas variáveis `SMTP_*` do
 * console (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`). Lidas a cada envio, como na demo: o
 * painel pode trocá-las sem reiniciar. Sem SMTP, nada sai: o log registra e quem chama segue (o registro em
 * `billing.tenant_notification` fica sem `sent_at`).
 *
 * Os links dos e-mails: `CONSOLE_URL` (o console do cliente) e `UPGRADE_URL_BASE` (a loja, Planos e módulos, a mesma
 * variável que a API põe no `upgrade_url` dos erros). Sem `CONSOLE_URL`, o console é a origem de `UPGRADE_URL_BASE`
 * mais `/client`; sem nenhuma das duas, os e-mails saem sem link.
 */
import { createHash } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from '../logger.js';

function smtp(env: NodeJS.ProcessEnv = process.env) {
  const user = env.SMTP_USER;
  return {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 465),
    user,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM ?? user,
  };
}

export const smtpConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const c = smtp(env);
  return Boolean(c.host && c.user && c.password && c.from);
};

let cached: { key: string; transport: Transporter } | null = null;
function transport(env: NodeJS.ProcessEnv): Transporter {
  const c = smtp(env);
  // a chave do cache não guarda a senha em claro (só a impressão dela)
  const key = JSON.stringify([
    c.host,
    c.port,
    c.user,
    createHash('sha256')
      .update(c.password ?? '')
      .digest('hex'),
  ]);
  if (cached?.key !== key)
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.port === 465,
        auth: { user: c.user, pass: c.password },
      }),
    };
  return cached.transport;
}

export interface OutgoingMail {
  to: readonly string[];
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  delivered: boolean;
  /** `SMTP not configured`, `no recipients` ou a mensagem do transporte. */
  error?: string;
}

export type MailSender = (mail: OutgoingMail) => Promise<SendResult>;

/** Envia pelo SMTP configurado; sem SMTP, log (sem o corpo) e `delivered: false`. */
export async function sendMail(
  mail: OutgoingMail,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SendResult> {
  if (!mail.to.length) return { delivered: false, error: 'no recipients' };
  if (!smtpConfigured(env)) {
    logger.info(
      { to: mail.to.length, subject: mail.subject },
      'SMTP não configurado; e-mail do ciclo de vida registrado sem entrega',
    );
    return { delivered: false, error: 'SMTP not configured' };
  }
  try {
    await transport(env).sendMail({
      from: smtp(env).from,
      to: [...mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return { delivered: true };
  } catch (err) {
    logger.error({ err, subject: mail.subject }, 'falha ao enviar e-mail do ciclo de vida');
    return { delivered: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface MailLinks {
  /** Console do cliente (`/client`); null sem configuração. */
  console: string | null;
  /** Planos e módulos (a loja); null sem `UPGRADE_URL_BASE`. */
  store: string | null;
}

/** Links dos e-mails a partir do env (ver o cabeçalho). URL inválida conta como ausente. */
export function mailLinks(env: NodeJS.ProcessEnv = process.env): MailLinks {
  const parse = (v: string | undefined) => {
    const raw = v?.trim();
    if (!raw) return null;
    try {
      return new URL(raw);
    } catch {
      return null;
    }
  };
  const store = parse(env.UPGRADE_URL_BASE);
  const console_ = parse(env.CONSOLE_URL) ?? (store ? new URL('/client', store.origin) : null);
  return { console: console_?.toString() ?? null, store: store?.toString() ?? null };
}
