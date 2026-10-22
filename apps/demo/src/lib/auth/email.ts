/**
 * E-mails do acesso à demo (convite e redefinição de senha). Com SMTP_* configurado, envia de verdade;
 * sem SMTP (desenvolvimento), escreve o link no log do servidor. O link nunca é gravado no banco.
 */
import nodemailer, { type Transporter } from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER;

export const smtpConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD && SMTP_FROM);

let transporter: Transporter | null = null;
function transport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  return transporter;
}

export type AccessEmailKind = 'invite' | 'reset';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function render(kind: AccessEmailKind, name: string, url: string, expiresInHours: number) {
  const first = name.split(/\s+/)[0] || name;
  const subject =
    kind === 'invite' ? 'Seu acesso à demo do Galaxie Sports' : 'Redefinição de senha · Galaxie Sports';
  const intro =
    kind === 'invite'
      ? 'Você foi convidado(a) para conhecer a demonstração do Galaxie Sports: metadados esportivos navegáveis, de países e competições até times, clássicos e partidas.'
      : 'Recebemos um pedido para redefinir a sua senha da demo do Galaxie Sports.';
  const action = kind === 'invite' ? 'Criar minha senha' : 'Redefinir senha';
  const text = `Olá, ${first}!\n\n${intro}\n\n${action}: ${url}\n\nO link vale por ${expiresInHours} horas. Se você não esperava este e-mail, pode ignorá-lo.\n\nGalaxie Works`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0b0f14;font-family:Segoe UI,Arial,sans-serif;color:#e6e9ee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141a21;border:1px solid #232b35;border-radius:12px;padding:32px">
<tr><td style="font-size:20px;font-weight:600;color:#ffffff">Olá, ${escapeHtml(first)}!</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#b5bcc7">${escapeHtml(intro)}</td></tr>
<tr><td style="padding-top:24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#6c69f2;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">${action}</a></td></tr>
<tr><td style="padding-top:20px;font-size:13px;line-height:1.5;color:#7d8794">O link vale por ${expiresInHours} horas. Se você não esperava este e-mail, pode ignorá-lo.</td></tr>
</table>
<p style="font-size:12px;color:#5c6672;margin-top:16px">Galaxie Works · Galaxie Sports</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

export interface SendResult {
  delivered: boolean;
  error?: string;
}

export async function sendAccessEmail(opts: {
  kind: AccessEmailKind;
  to: string;
  name: string;
  url: string;
  expiresInHours: number;
}): Promise<SendResult> {
  const { subject, text, html } = render(opts.kind, opts.name, opts.url, opts.expiresInHours);
  if (!smtpConfigured) {
    // Desenvolvimento: sem SMTP, o link vai só para o log do servidor (nunca para o banco).
    console.info(`[demo-auth] SMTP não configurado; ${opts.kind} para ${opts.to}: ${opts.url}`);
    return { delivered: false, error: 'SMTP não configurado' };
  }
  try {
    await transport().sendMail({ from: SMTP_FROM, to: opts.to, subject, text, html });
    return { delivered: true };
  } catch (err) {
    console.error('[demo-auth] falha ao enviar e-mail', err);
    return { delivered: false, error: err instanceof Error ? err.message : String(err) };
  }
}
