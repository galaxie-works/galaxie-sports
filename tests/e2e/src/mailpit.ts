/**
 * SMTP falso (Mailpit, opção A de docs/qa/README.md, "Autenticação no teste"): a demo manda os e-mails de verdade
 * (código de acesso, convite, boas-vindas) para ele, e o teste lê pela API HTTP (`/api/v1`). Nenhuma linha do produto
 * muda para o teste: é o mesmo `sendMail` de produção, com `SMTP_HOST` apontado para o Mailpit.
 *
 * Os helpers recebem um `APIRequestContext` do Playwright (o `request` do teste), então as chamadas ao Mailpit entram no
 * trace quando um teste falha. O código lido nunca é escrito em log.
 */
import { expect, type APIRequestContext } from '@playwright/test';

import { MAILPIT_URL } from './env.ts';

interface MailSummary {
  ID: string;
  Subject: string;
  Created: string;
}

export interface Mail {
  id: string;
  subject: string;
  text: string;
  html: string;
}

async function search(request: APIRequestContext, to: string): Promise<MailSummary[]> {
  const res = await request.get(`${MAILPIT_URL}/api/v1/search`, {
    params: { query: `to:"${to}"`, limit: '50' },
  });
  expect(res.ok(), `Mailpit respondeu ${res.status()} na busca`).toBeTruthy();
  return ((await res.json()) as { messages: MailSummary[] | null }).messages ?? [];
}

/** IDs das mensagens que já estão na caixa de `to` (para esperar só pela próxima). */
export async function mailboxIds(request: APIRequestContext, to: string): Promise<Set<string>> {
  return new Set((await search(request, to)).map((m) => m.ID));
}

/**
 * Espera a primeira mensagem nova para `to` (fora de `seen`) e devolve o corpo. O Mailpit lista da mais nova para a
 * mais antiga. Espera por estado (polling do `expect`), nunca por tempo fixo.
 */
export async function waitForMail(
  request: APIRequestContext,
  to: string,
  seen: Set<string> = new Set(),
  timeout = 20_000,
): Promise<Mail> {
  let found: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        found = (await search(request, to)).find((m) => !seen.has(m.ID));
        return Boolean(found);
      },
      { message: `nenhum e-mail novo para ${to} no Mailpit`, timeout },
    )
    .toBe(true);
  const res = await request.get(`${MAILPIT_URL}/api/v1/message/${found!.ID}`);
  expect(res.ok(), `Mailpit respondeu ${res.status()} ao abrir a mensagem`).toBeTruthy();
  const body = (await res.json()) as { ID: string; Subject: string; Text: string; HTML: string };
  return { id: body.ID, subject: body.Subject, text: body.Text, html: body.HTML };
}

/** Código de acesso de 6 dígitos do e-mail de login (a linha que tem só o código, em `lib/auth/email.ts`). */
export function otpFrom(mail: Mail): string {
  const code = /^\s*(\d{6})\s*$/m.exec(mail.text)?.[1];
  if (!code) throw new Error(`o e-mail "${mail.id}" não traz um código de 6 dígitos`);
  return code;
}

/** Primeiro link `http(s)` do texto do e-mail (convite, boas-vindas); `startsWith` filtra pelo começo da URL. */
export function linkFrom(mail: Mail, startsWith = 'http'): string {
  const link = mail.text.match(/https?:\/\/\S+/g)?.find((url) => url.startsWith(startsWith));
  if (!link) throw new Error(`o e-mail "${mail.id}" não traz link que comece com ${startsWith}`);
  return link;
}
