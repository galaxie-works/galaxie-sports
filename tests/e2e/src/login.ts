/**
 * Login de verdade pela tela `/login` (código por e-mail, Better Auth): pede o código, lê no Mailpit e digita. É o
 * caminho do usuário, sem atalho no produto (a opção C do brief, código fixo, está descartada).
 *
 * O `otp-guard` da demo aceita um pedido de código a cada 45 s por e-mail e o Better Auth, em produção, 3 por minuto
 * por IP: cada papel entra uma vez no projeto `setup` e os outros testes reaproveitam a sessão (`storageState`).
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { mailboxIds, otpFrom, waitForMail } from './mailpit.ts';

/** Entra como `email` e espera chegar em `next` (caminho interno, como `/settings` ou `/client`). */
export async function loginWithCode(
  page: Page,
  request: APIRequestContext,
  email: string,
  next: string,
): Promise<void> {
  const seen = await mailboxIds(request, email);
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  // ids estáveis da tela (components/auth/login-form.tsx); os rótulos mudam com o idioma
  await page.locator('#email').fill(email);
  await page.locator('form button[type="submit"]').click();
  const code = otpFrom(await waitForMail(request, email, seen));
  const otp = page.locator('#otp');
  await expect(otp).toBeEditable();
  // o campo confere sozinho ao completar os 6 dígitos (onComplete) e a tela troca para `next`
  await otp.fill(code);
  await page.waitForURL((url) => url.pathname === next || url.pathname.startsWith(`${next}/`));
}
