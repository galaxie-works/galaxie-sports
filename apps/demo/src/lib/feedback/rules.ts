/**
 * Regras do "Sugerir ou reportar algo" (puras: o formulário no navegador, a ação do servidor e os testes).
 *
 * - assuntos: a chave vai no envio; o rótulo da issue (em pt-BR) sai dela em lib/i18n/messages/feedback-issue.ts,
 *   para a lista de rótulos da repo não depender do idioma da tela;
 * - limites da mensagem e dos anexos (só JPG e PNG, conferidos pelo conteúdo, não pela extensão);
 */

export const FEEDBACK_SUBJECTS = ['bug', 'feature', 'content', 'data', 'question', 'other'] as const;
export type FeedbackSubject = (typeof FEEDBACK_SUBJECTS)[number];

export const isFeedbackSubject = (value: unknown): value is FeedbackSubject =>
  typeof value === 'string' && (FEEDBACK_SUBJECTS as readonly string[]).includes(value);

export const FEEDBACK_MESSAGE_MIN = 10;
/** Mensagem longa o bastante para um relato com passos; o corpo da issue aceita 65.536 caracteres. */
export const FEEDBACK_MESSAGE_MAX = 4000;
export const FEEDBACK_MAX_FILES = 4;
/** Total dos anexos: abaixo do teto das server actions (`bodySizeLimit` de 6 MB no next.config.ts). */
export const FEEDBACK_MAX_MB = 5;
export const FEEDBACK_MAX_BYTES = FEEDBACK_MAX_MB * 1024 * 1024;

export type FeedbackImageType = 'image/png' | 'image/jpeg';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/** Tipo da imagem pela assinatura dos primeiros bytes; null se não é PNG nem JPEG. */
export function sniffImage(bytes: Uint8Array): FeedbackImageType | null {
  if (PNG.every((b, i) => bytes[i] === b)) return 'image/png';
  if (JPEG.every((b, i) => bytes[i] === b)) return 'image/jpeg';
  return null;
}

/** Tipo aceito no seletor de arquivo (o navegador filtra; o servidor confere pelo conteúdo). */
export const FEEDBACK_ACCEPT = 'image/png,image/jpeg,.png,.jpg,.jpeg';

export const isAcceptedImageType = (type: string) => type === 'image/png' || type === 'image/jpeg';

/** Primeiros caracteres da mensagem para o título da issue (uma linha, sem espaços repetidos). */
export function titleSnippet(message: string, max = 50): string {
  const line = message.replace(/\s+/g, ' ').trim();
  const chars = Array.from(line);
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : line;
}

/** Problema do envio, traduzido no formulário (`feedback.errors.*`). */
export type FeedbackErrorCode =
  | 'subject'
  | 'message'
  | 'tooLong'
  | 'fileType'
  | 'tooMany'
  | 'tooLarge'
  | 'session'
  | 'limited'
  | 'unavailable'
  | 'generic';

/** Confere assunto e mensagem; null quando está tudo certo. */
export function checkFeedbackText(subject: unknown, message: unknown): FeedbackErrorCode | null {
  if (!isFeedbackSubject(subject)) return 'subject';
  if (typeof message !== 'string' || message.trim().length < FEEDBACK_MESSAGE_MIN) return 'message';
  if (message.length > FEEDBACK_MESSAGE_MAX) return 'tooLong';
  return null;
}
