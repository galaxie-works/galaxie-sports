'use server';

/**
 * Envio do "Sugerir ou reportar algo" (ícone de chat do cabeçalho). Quem enviou e o tenant vêm da sessão no
 * servidor, nunca do formulário. As imagens são recodificadas sem metadados
 * (lib/feedback/image.ts) e gravadas no bucket privado; a issue é aberta na repo privada de sugestões
 * (lib/feedback/github.ts) com referências opacas de quem enviou e links assinados das imagens (signing.ts).
 */
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';

import { roleOf } from '@/lib/auth/roles';
import { auth, isAccessExpired } from '@/lib/auth/server';
import { getTenantInfo, isUuid } from '@/lib/client/tenants';
import { getRequestLocale } from '@/lib/i18n/server';
import { internalPath } from '@/lib/internal-path';

import { attachmentStoreConfigured, deleteAttachment, putAttachment } from './attachments';
import { FeedbackGithub, FeedbackGithubError } from './github';
import { cleanImage } from './image';
import { feedbackRef, signAttachmentPath } from './signing';
import { feedbackIssueBody, feedbackIssueTitle } from './issue';
import { FeedbackLimiter } from './limiter';
import {
  checkFeedbackText,
  FEEDBACK_MAX_BYTES,
  FEEDBACK_MAX_FILES,
  sniffImage,
  type FeedbackErrorCode,
  type FeedbackImageType,
  type FeedbackSubject,
} from './rules';
import { readFeedbackSettings } from './settings-db';
import type { FeedbackSettings } from './settings';

export interface FeedbackResult {
  ok: boolean;
  error?: FeedbackErrorCode;
  /** Nome do arquivo recusado (erro `fileType`). */
  file?: string;
}

const limiter = new FeedbackLimiter();
let github: { key: string; client: FeedbackGithub } | null = null;

const FILE_NAME_MAX = 80;
const cleanName = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}._ -]/gu, '')
    .trim()
    .slice(0, FILE_NAME_MAX) || 'img';

export async function sendFeedback(form: FormData): Promise<FeedbackResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAccessExpired(session.user)) return { ok: false, error: 'session' };

  // lido a cada envio: vale sem reiniciar, em qualquer contêiner. Sem conseguir ler o ajuste, não envia
  let settings: FeedbackSettings;
  try {
    settings = await readFeedbackSettings();
  } catch (err) {
    console.error('[feedback] não deu para ler a configuração', err);
    return { ok: false, error: 'unavailable' };
  }
  if (!settings.enabled) return { ok: false, error: 'unavailable' };
  if (settings.tokenUnreadable)
    console.error('[feedback] o token salvo no painel não abre com a KEK atual: usando o do ambiente');

  const subject = form.get('subject');
  const message = form.get('message');
  const textError = checkFeedbackText(subject, message);
  if (textError) return { ok: false, error: textError };

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > FEEDBACK_MAX_FILES) return { ok: false, error: 'tooMany' };
  if (files.reduce((sum, f) => sum + f.size, 0) > FEEDBACK_MAX_BYTES) return { ok: false, error: 'tooLarge' };

  const config = settings.config;
  const secret = process.env.BETTER_AUTH_SECRET;
  const publicUrl = process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, '');
  if (!config || !secret || !publicUrl) return { ok: false, error: 'unavailable' };
  if (files.length && !attachmentStoreConfigured()) return { ok: false, error: 'unavailable' };
  const key = `${config.repo}|${config.token}`;
  if (github?.key !== key) github = { key, client: new FeedbackGithub(config) };
  const client = github.client;

  // o limite vem antes de decodificar: recodificar imagem é a parte cara do envio
  const userId = session.user.id;
  const at = Date.now();
  if (!limiter.take(userId, at)) return { ok: false, error: 'limited' };

  const images: { name: string; type: FeedbackImageType; body: Uint8Array }[] = [];
  for (const file of files) {
    const raw = new Uint8Array(await file.arrayBuffer());
    const type = sniffImage(raw);
    let body: Uint8Array | null = null;
    if (type) {
      try {
        body = await cleanImage(raw, type);
      } catch {
        // assinatura certa, conteúdo que o decodificador recusa (truncado, forjado ou acima do teto de pixels)
      }
    }
    // arquivo recusado gasta a vaga do limite de propósito: senão dava para forçar decodificação sem parar
    if (!type || !body) {
      return { ok: false, error: 'fileType', file: cleanName(file.name) };
    }
    images.push({ name: cleanName(file.name), type, body });
  }

  const stored: string[] = [];
  try {
    // repo pública = dado de cliente exposto: não envia nada
    await client.ensurePrivate();
    const month = new Date(at).toISOString().slice(0, 7);
    const nowS = Math.floor(at / 1000);
    const attachments: { url: string; name: string }[] = [];
    for (const img of images) {
      // bucket privado; a issue leva só o link assinado (vale um ano), que a demo confere antes de entregar
      const key = `${month}/${randomUUID()}.${img.type === 'image/png' ? 'png' : 'jpg'}`;
      await putAttachment(key, img.body, img.type);
      stored.push(key);
      attachments.push({ url: publicUrl + signAttachmentPath(secret, key, nowS), name: img.name });
    }

    const role = roleOf(session.user.role);
    const tenantId = role === 'client' ? (session.user as { tenantId?: string | null }).tenantId : null;
    const tenant = isUuid(tenantId) ? await getTenantInfo(tenantId) : null;
    const text = (message as string).trim();
    const viewport = form.get('viewport');
    const page = internalPath(form.get('page'));
    const label = await client.ensureLabel(subject as FeedbackSubject);
    const number = await client.createIssue(
      feedbackIssueTitle(subject as FeedbackSubject, text),
      feedbackIssueBody({
        subject: subject as FeedbackSubject,
        message: text,
        // referências opacas e estáveis: nem e-mail nem nome do tenant saem da demo
        user: feedbackRef(secret, 'u', userId),
        tenant: tenant ? feedbackRef(secret, 't', tenant.id) : null,
        role,
        // só o caminho: a query string pode levar filtros e ids internos
        page: page ? page.split(/[?#]/)[0]!.slice(0, 200) : null,
        locale: await getRequestLocale(),
        userAgent: (await headers()).get('user-agent')?.slice(0, 300) ?? null,
        viewport: typeof viewport === 'string' && /^\d{2,5}x\d{2,5}$/.test(viewport) ? viewport : null,
        version: process.env.GALAXIE_IMAGE_HASH || 'dev',
        sentAt: new Date(at),
        attachments,
      }),
      label,
    );
    console.info(
      '[feedback] issue aberta',
      JSON.stringify({ user: userId, subject, number, files: images.length }),
    );
    return { ok: true };
  } catch (err) {
    limiter.release(userId, at);
    // a issue não saiu: as imagens já gravadas não têm quem as mostre
    await Promise.allSettled(stored.map((k) => deleteAttachment(k)));
    if (err instanceof FeedbackGithubError && err.code === 'not_private') {
      console.error('[feedback] envio recusado: a repo de sugestões não é privada', config.repo);
      return { ok: false, error: 'unavailable' };
    }
    console.error('[feedback] falha no envio', err);
    return { ok: false, error: 'generic' };
  }
}
