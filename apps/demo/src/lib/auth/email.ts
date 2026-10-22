/**
 * E-mails do acesso à demo: o convite (link para a tela de login) e o código de acesso (OTP). Com SMTP_*
 * configurado, envia de verdade; sem SMTP, o convite vai para o log do servidor e o código também, mas só
 * em desenvolvimento (em produção um código nunca é escrito em log). Nada disso é gravado no banco.
 */
import nodemailer, { type Transporter } from 'nodemailer';

import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER;

export const smtpConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD && SMTP_FROM);
const isProduction = process.env.NODE_ENV === 'production';

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

export type AccessEmail =
  | {
      kind: 'invite';
      to: string;
      name: string;
      /** Endereço da tela de login (sem dados da pessoa na URL). */
      url: string;
      /** Fim do acesso; null = sem prazo. */
      accessExpiresAt: Date | null;
      /** Idioma de quem recebe. */
      locale: Locale;
    }
  | {
      kind: 'otp';
      to: string;
      name: string;
      code: string;
      expiresInMinutes: number;
      locale: Locale;
    };

export type AccessEmailKind = AccessEmail['kind'];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Data longa no idioma de quem recebe, no fuso do mercado (o e-mail não sabe o fuso da pessoa). */
const longDate = (locale: Locale, date: Date) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: locale === 'es-AR' ? 'America/Argentina/Buenos_Aires' : 'America/Sao_Paulo',
  }).format(date);

const firstName = (name: string) => name.split(/\s+/)[0] || name;

function greetingOf(mail: AccessEmail) {
  const t = getDictionary(mail.locale).email;
  const name = firstName(mail.name);
  return name ? fill(t.greeting, { name }) : t.greetingNoName;
}

/** Moldura escura comum aos dois e-mails (tabelas e estilos inline, para os clientes de e-mail). */
function frame(locale: Locale, greeting: string, rows: string) {
  return `<!doctype html><html lang="${locale}"><body style="margin:0;background:#0b0f14;font-family:Segoe UI,Arial,sans-serif;color:#e6e9ee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141a21;border:1px solid #232b35;border-radius:12px;padding:32px">
<tr><td style="font-size:20px;font-weight:600;color:#ffffff">${escapeHtml(greeting)}</td></tr>
${rows}
</table>
<p style="font-size:12px;color:#5c6672;margin-top:16px">Galaxie Works · Galaxie Sports</p>
</td></tr></table></body></html>`;
}

const paragraph = (text: string, style = 'padding-top:12px;font-size:15px;line-height:1.6;color:#b5bcc7') =>
  `<tr><td style="${style}">${escapeHtml(text)}</td></tr>`;
const footnote = (text: string) =>
  paragraph(text, 'padding-top:20px;font-size:13px;line-height:1.5;color:#7d8794');

function renderInvite(mail: Extract<AccessEmail, { kind: 'invite' }>) {
  const t = getDictionary(mail.locale).email;
  const greeting = greetingOf(mail);
  const { subject, intro, how, action, ignore } = t.invite;
  const validity = mail.accessExpiresAt
    ? fill(t.invite.validUntil, { date: longDate(mail.locale, mail.accessExpiresAt) })
    : t.invite.noExpiry;
  const text = `${greeting}\n\n${intro}\n\n${how}\n\n${action}: ${mail.url}\n\n${validity} ${ignore}\n\n${t.signature}`;
  const html = frame(
    mail.locale,
    greeting,
    `${paragraph(intro)}
${paragraph(how)}
<tr><td style="padding-top:24px"><a href="${escapeHtml(mail.url)}" style="display:inline-block;background:#6c69f2;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">${action}</a></td></tr>
${footnote(`${validity} ${ignore}`)}`,
  );
  return { subject, text, html };
}

function renderOtp(mail: Extract<AccessEmail, { kind: 'otp' }>) {
  const t = getDictionary(mail.locale).email;
  const greeting = greetingOf(mail);
  const subject = fill(t.otp.subject, { code: mail.code });
  const { intro, ignore } = t.otp;
  const validity = fill(t.otp.validity, { minutes: mail.expiresInMinutes });
  const text = `${greeting}\n\n${intro}\n\n${mail.code}\n\n${validity}\n${ignore}\n\n${t.signature}`;
  const html = frame(
    mail.locale,
    greeting,
    `${paragraph(intro)}
<tr><td style="padding-top:20px"><div style="display:inline-block;background:#0b0f14;border:1px solid #232b35;border-radius:10px;padding:14px 22px;font-family:Consolas,'SFMono-Regular',Menlo,'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#ffffff">${escapeHtml(mail.code)}</div></td></tr>
${footnote(validity)}
${paragraph(ignore, 'padding-top:6px;font-size:13px;line-height:1.5;color:#7d8794')}`,
  );
  return { subject, text, html };
}

export interface SendResult {
  delivered: boolean;
  error?: string;
}

export async function sendAccessEmail(mail: AccessEmail): Promise<SendResult> {
  const { subject, text, html } = mail.kind === 'invite' ? renderInvite(mail) : renderOtp(mail);
  if (!smtpConfigured) {
    if (mail.kind === 'invite') {
      // Sem SMTP: o link do convite (só a tela de login, nada secreto) vai para o log do servidor.
      console.info(`[demo-auth] SMTP não configurado; convite para ${mail.to}: ${mail.url}`);
    } else if (!isProduction) {
      // Desenvolvimento: sem SMTP, o código vai só para o log do servidor (nunca para o banco).
      console.info(`[demo-auth] SMTP não configurado; código de acesso para ${mail.to}: ${mail.code}`);
    } else {
      console.error(`[demo-auth] SMTP não configurado; código de acesso para ${mail.to} não foi entregue.`);
    }
    return { delivered: false, error: 'SMTP not configured' };
  }
  try {
    await transport().sendMail({ from: SMTP_FROM, to: mail.to, subject, text, html });
    return { delivered: true };
  } catch (err) {
    console.error('[demo-auth] falha ao enviar e-mail', err);
    return { delivered: false, error: err instanceof Error ? err.message : String(err) };
  }
}
