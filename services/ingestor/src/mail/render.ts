/**
 * Moldura dos e-mails do worker: a mesma dos e-mails do console (tabelas e estilos inline, para os clientes de e-mail),
 * com saudação, parágrafos, uma lista numerada (o checklist das boas-vindas), um botão e a assinatura. Devolve texto e
 * HTML.
 */
import { fill, MAIL_TEXTS, type MailLocale } from './texts.js';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const firstName = (name: string) => name.split(/\s+/)[0] || name;

export interface RenderInput {
  locale: MailLocale;
  /** Nome de quem recebe (só o primeiro nome entra); vazio = saudação sem nome. */
  name: string;
  subject: string;
  paragraphs: string[];
  /** Passos numerados, entre os parágrafos e o botão. */
  steps?: string[];
  action?: { label: string; url: string } | null;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function renderMail(input: RenderInput): RenderedMail {
  const t = MAIL_TEXTS[input.locale];
  const name = firstName(input.name);
  const greeting = name ? fill(t.greeting, { name }) : t.greetingNoName;
  const steps = input.steps ?? [];
  const text = [
    greeting,
    ...input.paragraphs,
    ...(steps.length ? [steps.map((s, i) => `${i + 1}. ${s}`).join('\n')] : []),
    ...(input.action ? [`${input.action.label}: ${input.action.url}`] : []),
    t.signature,
  ].join('\n\n');
  const rows = [
    ...input.paragraphs.map(
      (p) =>
        `<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#b5bcc7">${escapeHtml(p)}</td></tr>`,
    ),
    ...(steps.length
      ? [
          `<tr><td style="padding-top:12px"><ol style="margin:0;padding-left:22px;font-size:15px;line-height:1.7;color:#b5bcc7">${steps
            .map((s) => `<li>${escapeHtml(s)}</li>`)
            .join('')}</ol></td></tr>`,
        ]
      : []),
    ...(input.action
      ? [
          `<tr><td style="padding-top:24px"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#6c69f2;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">${escapeHtml(input.action.label)}</a></td></tr>`,
        ]
      : []),
  ].join('\n');
  const html = `<!doctype html><html lang="${input.locale}"><body style="margin:0;background:#0b0f14;font-family:Segoe UI,Arial,sans-serif;color:#e6e9ee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141a21;border:1px solid #232b35;border-radius:12px;padding:32px">
<tr><td style="font-size:20px;font-weight:600;color:#ffffff">${escapeHtml(greeting)}</td></tr>
${rows}
</table>
<p style="font-size:12px;color:#5c6672;margin-top:16px">${escapeHtml(t.signature)} · Galaxie Sports</p>
</td></tr></table></body></html>`;
  return { subject: input.subject, text, html };
}
