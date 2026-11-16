/**
 * Domínio de e-mail do cadastro (PL2): e-mail de empresa entra direto; e-mail de provedor grátis não é barrado, mas
 * a organização nasce em revisão manual (`review_status = 'pending'`) e nada de produção é criado até a equipe
 * aprovar. Um trial por domínio de e-mail (de empresa): a conferência fica em `guards.ts`. Puro.
 */

/** Provedores de e-mail grátis, pelo primeiro rótulo do domínio (`gmail.com`, `yahoo.com.br`, `me.com`). */
export const FREE_EMAIL_PROVIDERS: readonly string[] = [
  'gmail',
  'googlemail',
  'hotmail',
  'outlook',
  'live',
  'msn',
  'yahoo',
  'icloud',
  'me',
  'aol',
  'proton',
  'protonmail',
  'gmx',
  'zoho',
  'uol',
  'bol',
  'terra',
  'ig',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** E-mail como o Better Auth grava (aparado, em minúsculas); null se não tem cara de e-mail. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

/** O domínio de um e-mail já normalizado (`ana@empresa.com.br` → `empresa.com.br`). */
export const emailDomain = (email: string): string => email.slice(email.lastIndexOf('@') + 1);

/** O domínio é de provedor grátis? (`outlook.com.br` conta: vale o primeiro rótulo) */
export function isFreeEmailDomain(domain: string): boolean {
  const first = domain.toLowerCase().split('.')[0] ?? '';
  return FREE_EMAIL_PROVIDERS.includes(first);
}
