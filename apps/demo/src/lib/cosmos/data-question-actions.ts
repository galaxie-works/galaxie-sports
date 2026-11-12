'use server';

/**
 * Ações do modo "Dados da API" do assistente da Cosmos (#1006). O tenant, o cargo e o plano saem da sessão; a
 * pergunta e a tela vêm do navegador e são conferidas aqui antes do laço.
 */
import { readClientContext } from '@/lib/client/session';
import { getRequestLocale } from '@/lib/i18n/server';

import { assistantAccessError } from './assistant-server';
import { allowEstimate } from './assistant-limits';
import {
  askDataQuestion,
  dataQuestionMinCredits,
  type DataAnswer,
  type DataQuestionError,
} from './data-question-server';
import { DATA_QUESTION_MAX } from './data-questions';

/** Se o modo aparece no painel e o mínimo da função (0 = equipe Galaxie, que não gasta créditos do cliente). */
export async function dataQuestionMode(): Promise<{ available: boolean; minCredits: number }> {
  const ctx = await readClientContext();
  if (!ctx || assistantAccessError(ctx)) return { available: false, minCredits: 0 };
  // a consulta lê o catálogo da Cosmos: com o mesmo limite da estimativa do painel
  if (!allowEstimate(ctx.userId)) return { available: false, minCredits: 0 };
  const min = await dataQuestionMinCredits();
  if (min === null) return { available: false, minCredits: 0 };
  return { available: true, minCredits: ctx.role === 'admin' ? 0 : min };
}

const ROUTE_MAX = 200;
const TITLE_MAX = 200;

export async function askDataWithCosmos(input: {
  question: unknown;
  context: unknown;
}): Promise<
  { ok: true; result: DataAnswer } | { ok: false; error: DataQuestionError | 'empty' | 'tooLong' }
> {
  const ctx = await readClientContext();
  if (!ctx) return { ok: false, error: 'unauthorized' };
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) return { ok: false, error: 'empty' };
  if ([...question].length > DATA_QUESTION_MAX) return { ok: false, error: 'tooLong' };
  const c =
    input.context && typeof input.context === 'object' ? (input.context as Record<string, unknown>) : {};
  const context = {
    route: typeof c.route === 'string' ? c.route.slice(0, ROUTE_MAX) : '/',
    title: typeof c.title === 'string' ? c.title.slice(0, TITLE_MAX) : '',
  };
  return askDataQuestion(ctx, { question, context }, await getRequestLocale());
}
