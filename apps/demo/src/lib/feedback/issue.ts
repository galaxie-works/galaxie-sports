/**
 * Título e corpo da issue do "Sugerir ou reportar algo" (puro, testado). Tudo o que veio do usuário entra como
 * texto, não como Markdown: a mensagem vai num bloco cercado (fence mais longa que qualquer sequência de crases ou
 * tis dela), então link, imagem rastreadora, `<!--`, menção, referência a outra repo e tabela falsa aparecem
 * literais; navegador, tela e página vão em `code`. Só os anexos (links assinados da demo) viram imagem.
 */
import { FEEDBACK_ISSUE_TEXT as T, FEEDBACK_LABELS } from '@/lib/i18n/messages/feedback-issue';

import { titleSnippet, type FeedbackSubject } from './rules';

export interface FeedbackIssueInput {
  subject: FeedbackSubject;
  message: string;
  /** Referências opacas (`u_…`, `t_…`), nunca e-mail ou nome. */
  user: string;
  tenant: string | null;
  role: string;
  /** Só o caminho, sem query string. */
  page: string | null;
  locale: string;
  userAgent: string | null;
  viewport: string | null;
  version: string;
  sentAt: Date;
  attachments: { url: string; name: string }[];
}

/** Bloco cercado que nenhuma sequência da mensagem consegue fechar. */
export function fenced(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/~+/g), (m) => m[0].length));
  const fence = '~'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/** Valor de célula como `code`, sem crase, barra vertical nem quebra de linha que escapem da célula. */
export function codeCell(value: string | null | undefined): string {
  if (!value) return '—';
  const clean = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/`/g, "'")
    .replace(/\|/g, '/')
    .trim();
  return clean ? `\`${clean}\`` : '—';
}

const brasilia = (d: Date) =>
  `${new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d)} ${T.timeZoneSuffix}`;

/** Nome do anexo como texto alternativo da imagem (sem colchetes nem quebra). */
const altText = (name: string) => name.replace(/[[\]\r\n<>]/g, '').slice(0, 80) || 'img';

export function feedbackIssueTitle(subject: FeedbackSubject, message: string): string {
  return `${FEEDBACK_LABELS[subject]}: ${titleSnippet(message)}`;
}

export function feedbackIssueBody(i: FeedbackIssueInput): string {
  const rows: [string, string][] = [
    [T.subject, FEEDBACK_LABELS[i.subject]],
    [T.user, codeCell(i.user)],
    [T.tenant, codeCell(i.tenant)],
    [T.role, codeCell(i.role)],
    [T.page, codeCell(i.page)],
    [T.locale, codeCell(i.locale)],
    [T.viewport, codeCell(i.viewport)],
    [T.userAgent, codeCell(i.userAgent)],
    [T.version, codeCell(i.version)],
    [T.sentAt, brasilia(i.sentAt)],
  ];
  const lines = [
    `### ${T.message}`,
    '',
    fenced(i.message),
    '',
    `### ${T.details}`,
    '',
    '| | |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  ];
  if (i.attachments.length) {
    lines.push('', `### ${T.attachments}`, '');
    for (const a of i.attachments) lines.push(`![${altText(a.name)}](${a.url})`, '');
  }
  lines.push('', `_${T.footer}_`, '<!-- sugestao-app v=2 -->');
  return lines.join('\n');
}
