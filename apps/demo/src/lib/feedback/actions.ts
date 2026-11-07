'use server';

/**
 * Envio do "Sugerir ou reportar algo" (ícone de chat do cabeçalho). Quem enviou, o e-mail e o tenant vêm da
 * sessão no servidor, nunca do formulário, e saem daqui já mascarados. As imagens vão para o storage de assets
 * (o mesmo bucket público dos logos, com nome aleatório em `feedback/`) e entram na issue como imagem; a issue é
 * aberta pelo workflow que esta ação dispara (lib/feedback/github.ts).
 */
import { createHash, randomUUID } from 'node:crypto';
import { headers } from 'next/headers';

import { roleOf } from '@/lib/auth/roles';
import { auth, isAccessExpired } from '@/lib/auth/server';
import { getTenantInfo, isUuid } from '@/lib/client/tenants';
import { getRequestLocale } from '@/lib/i18n/server';
import { internalPath } from '@/lib/internal-path';
import { logoObjectStore } from '@/lib/lineup/store';

import { dispatchFeedback, feedbackGithubConfig, type FeedbackPayload } from './github';
import { FeedbackLimiter } from './limiter';
import {
  checkFeedbackText,
  FEEDBACK_MAX_BYTES,
  FEEDBACK_MAX_FILES,
  maskEmail,
  maskHalf,
  sniffImage,
  titleSnippet,
  type FeedbackErrorCode,
  type FeedbackSubject,
} from './rules';

export interface FeedbackResult {
  ok: boolean;
  error?: FeedbackErrorCode;
  /** Nome do arquivo recusado (erro `fileType`). */
  file?: string;
}

const limiter = new FeedbackLimiter();

const FILE_NAME_MAX = 80;
const cleanName = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}._ -]/gu, '')
    .trim()
    .slice(0, FILE_NAME_MAX) || 'imagem';

/** Base pública do storage (a mesma dos logos), sem barra no fim. */
const publicBase = () => process.env.ASSETS_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || null;

export async function sendFeedback(form: FormData): Promise<FeedbackResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAccessExpired(session.user)) return { ok: false, error: 'session' };

  const subject = form.get('subject');
  const message = form.get('message');
  const textError = checkFeedbackText(subject, message);
  if (textError) return { ok: false, error: textError };

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > FEEDBACK_MAX_FILES) return { ok: false, error: 'tooMany' };
  if (files.reduce((sum, f) => sum + f.size, 0) > FEEDBACK_MAX_BYTES) return { ok: false, error: 'tooLarge' };
  const images: { name: string; type: string; body: Uint8Array }[] = [];
  for (const file of files) {
    const body = new Uint8Array(await file.arrayBuffer());
    const type = sniffImage(body);
    if (!type) return { ok: false, error: 'fileType', file: cleanName(file.name) };
    images.push({ name: cleanName(file.name), type, body });
  }

  const github = feedbackGithubConfig();
  if (!github) return { ok: false, error: 'unavailable' };
  const store = images.length ? logoObjectStore() : null;
  const base = publicBase();
  if (images.length && (!store || !base)) return { ok: false, error: 'storage' };

  const userId = session.user.id;
  const at = Date.now();
  if (!limiter.take(userId, at)) return { ok: false, error: 'limited' };

  try {
    const attachments: FeedbackPayload['attachments'] = [];
    const month = new Date(at).toISOString().slice(0, 7);
    for (const img of images) {
      // nome aleatório: o bucket é público, então a URL não pode ser adivinhada a partir de outra
      const key = `feedback/${month}/${randomUUID()}.${img.type === 'image/png' ? 'png' : 'jpg'}`;
      const sha256 = createHash('sha256').update(img.body).digest('hex');
      try {
        await store!.put(key, img.body, img.type, sha256);
      } catch (err) {
        console.error('[feedback] falha ao gravar o anexo', err);
        limiter.release(userId, at);
        return { ok: false, error: 'storage' };
      }
      attachments.push({ url: `${base}/${key}`, name: img.name, type: img.type, bytes: img.body.byteLength });
    }

    const role = roleOf(session.user.role);
    const tenantId = role === 'client' ? (session.user as { tenantId?: string | null }).tenantId : null;
    const tenant = isUuid(tenantId) ? await getTenantInfo(tenantId) : null;
    const text = (message as string).trim();
    const str = (key: string, max: number) => {
      const v = form.get(key);
      return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
    };
    const payload: FeedbackPayload = {
      v: 1,
      subject: subject as FeedbackSubject,
      snippet: titleSnippet(text),
      message: text,
      email: maskEmail(session.user.email),
      tenant: tenant ? maskHalf(tenant.name) : null,
      role,
      page: internalPath(form.get('page'))?.slice(0, 300) ?? null,
      locale: await getRequestLocale(),
      user_agent: (await headers()).get('user-agent')?.slice(0, 300) ?? null,
      viewport: str('viewport', 20),
      version: process.env.GALAXIE_IMAGE_HASH || 'dev',
      sent_at: new Date(at).toISOString(),
      attachments,
    };
    if (!(await dispatchFeedback(github, payload))) {
      limiter.release(userId, at);
      return { ok: false, error: 'generic' };
    }
    console.info('[feedback] enviado', JSON.stringify({ user: userId, subject, files: attachments.length }));
    return { ok: true };
  } catch (err) {
    console.error('[feedback] falha no envio', err);
    limiter.release(userId, at);
    return { ok: false, error: 'generic' };
  }
}
