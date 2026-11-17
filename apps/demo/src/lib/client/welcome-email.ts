/**
 * E-mail de boas-vindas com o checklist da primeira sessão (plataforma comercial F3, decisão 11; doc 02
 * §Provisionamento, passo 9), só no servidor. Sai quando a marca entra em `trial`: no provisionamento (cadastro e
 * criação assistida) e na aprovação da revisão do cadastro (PL2), para os Donos e o Financeiro da organização, no
 * idioma dela (`billing.organization.locale`). O envio fica registrado em `billing.tenant_notification`
 * (`kind = 'welcome'`): rodar de novo não manda de novo. Sem SMTP, o registro fica sem `sent_at` e o log avisa; a falha
 * do envio apaga o registro para a próxima tentativa. Nenhuma falha aqui derruba o provisionamento: quem chama
 * registra e segue.
 */
import { and, eq } from 'drizzle-orm';

import type { Database } from '@galaxie/db/client';
import { tenant } from '@galaxie/db/schema';
import {
  claimTenantNotification,
  markTenantNotificationSent,
  releaseTenantNotification,
  tenantNotificationAudience,
} from '@galaxie/db/tenant-notifications';

import { AUTH_SCHEMA } from '@/lib/auth/db';
import { renderNotice, sendMail } from '@/lib/auth/email';
import { isLocale, negotiateLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import { SITE_URL } from '@/lib/site';

/** Idioma gravado na organização (`pt-BR`, `en`, `es-AR`, ou uma tag solta como `es`) → idioma da demo. */
export function organizationLocale(locale: string | null | undefined): Locale {
  return isLocale(locale) ? locale : negotiateLocale(locale ?? '');
}

export interface WelcomeEmailResult {
  /** Ao menos um destinatário recebeu. */
  delivered: boolean;
  recipients: string[];
  /** Por que nada saiu: já registrado antes, sem destinatário, marca inexistente, ou SMTP ausente (registrado). */
  skipped?: 'already' | 'no_recipients' | 'not_found' | 'no_smtp';
}

/** Data longa no idioma da organização, no fuso do mercado dela (o e-mail não sabe o fuso de cada pessoa). */
const longDate = (locale: Locale, date: Date) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: locale === 'es-AR' ? 'America/Argentina/Buenos_Aires' : 'America/Sao_Paulo',
  }).format(date);

/**
 * Manda as boas-vindas da marca, uma vez. `consoleUrl` é o endereço do console (padrão: o da plataforma, `/client`).
 */
export async function sendWelcomeEmail(
  db: Database,
  input: { tenantId: string; consoleUrl?: string; now?: Date },
): Promise<WelcomeEmailResult> {
  const audience = await tenantNotificationAudience(db, input.tenantId, { authSchema: AUTH_SCHEMA });
  if (!audience) return { delivered: false, recipients: [], skipped: 'not_found' };
  const id = await claimTenantNotification(db, { tenantId: input.tenantId, kind: 'welcome' });
  if (!id) return { delivered: false, recipients: [], skipped: 'already' };
  const recipients = audience.recipients.map((r) => r.email);
  if (!recipients.length) {
    await markTenantNotificationSent(db, id, { recipients: [], delivered: false });
    return { delivered: false, recipients: [], skipped: 'no_recipients' };
  }
  const [row] = await db
    .select({ trialEndsAt: tenant.trialEndsAt })
    .from(tenant)
    .where(eq(tenant.id, input.tenantId))
    .limit(1);
  const locale = organizationLocale(audience.locale);
  const t = getDictionary(locale).email.welcome;
  const consoleUrl = input.consoleUrl ?? `${SITE_URL}/client`;
  const vars = { brand: audience.tenantName };
  const intro = row?.trialEndsAt
    ? fill(t.intro, { ...vars, date: longDate(locale, row.trialEndsAt) })
    : fill(t.introNoDate, vars);

  let delivered = false;
  let smtpMissing = false;
  let failed = 0;
  for (const person of audience.recipients) {
    const mail = renderNotice({
      locale,
      name: person.name ?? '',
      subject: fill(t.subject, vars),
      paragraphs: [intro, t.checklistIntro],
      steps: [t.steps.call, t.steps.widget, t.steps.invite, t.steps.plan],
      action: { label: t.action, url: consoleUrl },
      footnote: t.footnote,
    });
    const r = await sendMail({ to: [person.email], ...mail });
    if (r.delivered) delivered = true;
    else if (r.error === 'SMTP not configured') smtpMissing = true;
    else failed += 1;
  }
  if (!delivered && !smtpMissing && failed) {
    // nada saiu por falha do transporte: a próxima rodada tenta de novo
    await releaseTenantNotification(db, id);
    return { delivered: false, recipients };
  }
  await markTenantNotificationSent(db, id, { recipients, delivered, at: input.now });
  return { delivered, recipients, ...(delivered ? {} : { skipped: 'no_smtp' as const }) };
}

/**
 * Boas-vindas para toda marca da organização que está em `trial` (a aprovação da revisão do cadastro move as marcas
 * irmãs juntas). Idempotente pelo registro de cada marca. Devolve quantas receberam agora.
 */
export async function sendWelcomeForOrganization(db: Database, organizationId: string): Promise<number> {
  const brands = await db
    .select({ id: tenant.id })
    .from(tenant)
    .where(and(eq(tenant.organizationId, organizationId), eq(tenant.state, 'trial')))
    .orderBy(tenant.name, tenant.slug);
  let sent = 0;
  for (const b of brands) {
    const r = await sendWelcomeEmail(db, { tenantId: b.id });
    if (r.delivered) sent += 1;
  }
  return sent;
}
