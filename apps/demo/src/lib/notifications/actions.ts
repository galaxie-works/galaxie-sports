'use server';

/**
 * Caixa de entrada (o sino do cabeçalho): ler, marcar como lido e responder um pedido de mais informações. O usuário
 * vem sempre da sessão no servidor; o id do aviso vindo do navegador só vale se for dele (store.ts filtra pelo dono).
 */
import { headers } from 'next/headers';

import { auth, isAccessExpired } from '@/lib/auth/server';
import { FeedbackGithub } from '@/lib/feedback/github';
import { fenced } from '@/lib/feedback/issue';
import { FeedbackLimiter } from '@/lib/feedback/limiter';
import { FEEDBACK_MESSAGE_MAX, FEEDBACK_MESSAGE_MIN } from '@/lib/feedback/rules';
import { readFeedbackSettings } from '@/lib/feedback/settings-db';
import { FEEDBACK_ISSUE_TEXT } from '@/lib/i18n/messages/feedback-issue';

import { answerableNotice, markAnswered, markInboxRead, readInbox, type Inbox } from './store';

/** Cada resposta vira comentário: o mesmo teto do envio de sugestões, num contador próprio. */
const limiter = new FeedbackLimiter();

async function sessionUser(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAccessExpired(session.user)) return null;
  return session.user.id;
}

/** A caixa de quem está logado; null sem sessão (o sino não aparece) ou sem banco. */
export async function loadInbox(): Promise<Inbox | null> {
  const userId = await sessionUser();
  if (!userId) return null;
  try {
    return await readInbox(userId);
  } catch (err) {
    console.error('[inbox] falha ao ler', err instanceof Error ? err.name : err);
    return null;
  }
}

/** Marca como lidos (todos, ou os ids dados). */
export async function markRead(ids?: string[]): Promise<boolean> {
  const userId = await sessionUser();
  if (!userId) return false;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) return false;
  try {
    await markInboxRead(userId, ids?.slice(0, 100));
    return true;
  } catch (err) {
    console.error('[inbox] falha ao marcar como lido', err instanceof Error ? err.name : err);
    return false;
  }
}

export type AnswerError =
  'session' | 'message' | 'tooLong' | 'limited' | 'closed' | 'unavailable' | 'generic';

/**
 * Resposta de quem enviou a um pedido de mais informações: vira comentário na issue, como texto (bloco cercado), e o
 * aviso deixa de pedir resposta. A equipe vê o comentário e move o card.
 */
export async function answerNotice(id: string, text: string): Promise<{ ok: boolean; error?: AnswerError }> {
  const userId = await sessionUser();
  if (!userId) return { ok: false, error: 'session' };
  if (typeof id !== 'string' || typeof text !== 'string') return { ok: false, error: 'generic' };
  const message = text.trim();
  if (message.length < FEEDBACK_MESSAGE_MIN) return { ok: false, error: 'message' };
  if (message.length > FEEDBACK_MESSAGE_MAX) return { ok: false, error: 'tooLong' };

  let target: { repo: string; issue: number } | null;
  let settings: Awaited<ReturnType<typeof readFeedbackSettings>>;
  try {
    [target, settings] = await Promise.all([answerableNotice(userId, id), readFeedbackSettings()]);
  } catch (err) {
    console.error('[inbox] falha ao preparar a resposta', err instanceof Error ? err.name : err);
    return { ok: false, error: 'unavailable' };
  }
  if (!target) return { ok: false, error: 'closed' };
  // a repo mudou no painel: o token novo não fala com a issue antiga
  if (!settings.enabled || !settings.config || settings.config.repo !== target.repo)
    return { ok: false, error: 'unavailable' };

  const at = Date.now();
  if (!limiter.take(userId, at)) return { ok: false, error: 'limited' };
  try {
    const gh = new FeedbackGithub(settings.config);
    await gh.ensurePrivate();
    await gh.comment(
      target.issue,
      [`**${FEEDBACK_ISSUE_TEXT.userReply}**`, '', fenced(message), '', '<!-- resposta-app v=1 -->'].join(
        '\n',
      ),
    );
    // o comentário já saiu: falhar aqui não pode virar "tente de novo" (repetiria o comentário)
    await markAnswered(userId, id).catch((err) =>
      console.error('[inbox] resposta enviada, aviso não marcado', err instanceof Error ? err.name : err),
    );
    console.info('[inbox] resposta enviada', JSON.stringify({ user: userId, issue: target.issue }));
    return { ok: true };
  } catch (err) {
    limiter.release(userId, at);
    console.error(
      '[inbox] falha ao enviar a resposta',
      err instanceof Error ? err.message.slice(0, 200) : err,
    );
    return { ok: false, error: 'generic' };
  }
}
