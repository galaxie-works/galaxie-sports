/**
 * Conta de revisão externa (ex.: a auditoria de cota da YouTube Data API, que pede login e senha de uma
 * conta de demonstração). O login da demo é só por código no e-mail, e o revisor não lê a nossa caixa.
 * Para UM e-mail configurado, o código de acesso é fixo e não sai por e-mail: o revisor pede o código na
 * tela de login e digita o código combinado.
 *
 * Tudo o mais continua igual: a conta precisa existir (convite do admin, papel `user`, de preferência com
 * prazo de acesso), o código vale 10 minutos depois do pedido, 5 tentativas por código e o bloqueio por
 * erros de `otp-guard.ts`. Sem as duas variáveis (ou com código fora do formato), nada muda.
 *
 * DEMO_REVIEWER_EMAIL=revisor@exemplo.com
 * DEMO_REVIEWER_CODE=123456   (6 dígitos; só no .env, nunca no repositório)
 */

export interface ReviewerLogin {
  email: string;
  code: string;
}

/** Lê a conta de revisão do ambiente; nula se faltar uma das variáveis ou o código não tiver `length` dígitos. */
export function reviewerLogin(env: Record<string, string | undefined>, length: number): ReviewerLogin | null {
  const email = env.DEMO_REVIEWER_EMAIL?.trim().toLowerCase();
  const code = env.DEMO_REVIEWER_CODE?.trim();
  if (!email || !code) return null;
  if (!new RegExp(`^\\d{${length}}$`).test(code)) {
    console.error(`[demo-auth] DEMO_REVIEWER_CODE precisa ter ${length} dígitos; conta de revisão desligada`);
    return null;
  }
  return { email, code };
}

/** O e-mail (já normalizado pelo Better Auth) é o da conta de revisão? */
export function isReviewerEmail(reviewer: ReviewerLogin | null, email: string): boolean {
  return reviewer !== null && email.trim().toLowerCase() === reviewer.email;
}

/** Código fixo para o login da conta de revisão; `undefined` = código aleatório de sempre. */
export function reviewerOtp(
  reviewer: ReviewerLogin | null,
  data: { email: string; type: string },
): string | undefined {
  return data.type === 'sign-in' && isReviewerEmail(reviewer, data.email) ? reviewer!.code : undefined;
}
