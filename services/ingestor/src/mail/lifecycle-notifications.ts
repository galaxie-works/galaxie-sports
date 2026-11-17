/**
 * E-mails do ciclo de vida do tenant dentro do `tenant.lifecycle` (plataforma comercial F3, decisão 11; doc 02 §O
 * trial: "e-mail no dia 23 e no dia 29"). Depois das transições do relógio, a tarefa decide o que cada tenant deve
 * receber (parte pura, `dueLifecycleNotifications`), registra em `billing.tenant_notification` antes de enviar (o
 * índice único por tenant, `kind` e `ref` é a idempotência: a segunda rodada do dia não envia de novo) e manda aos
 * Donos e ao Financeiro da organização, no idioma dela.
 *
 * Regras:
 * - **Lembrete do trial** (`trial_reminder`, `ref = '<dia>'`): o dia N do trial conta da entrada em `trial`
 *   (`state_since`; dia 1 = o dia da entrada), não de `trial_ends_at - TRIAL_DAYS`, porque a equipe pode estender o
 *   prazo. O lembrete do dia N sai na primeira rodada em que o dia atual ≥ N e o trial ainda não venceu; quando mais
 *   de um está devido ao mesmo tempo (a primeira rodada depois do deploy, um dia sem rodada), só o mais tardio é
 *   enviado e os demais ficam registrados sem envio, para não chegarem depois fora de hora.
 * - **Trial vencido**, **suspensão** e **cancelamento** (`trial_expired`, `ref = ''`; `suspended` e `cancelled`,
 *   `ref = state_since` ISO): saem quando a mudança de estado é recente (`STATE_MAIL_WINDOW_DAYS`); quem já estava no
 *   estado antes disto existir não recebe um aviso atrasado.
 * - **Teste de módulo acabando** (`module_trial_ending`, `ref = módulo`): `billing.module_trial` com `ends_at` entre
 *   agora e agora + `MODULE_TRIAL_REMINDER_DAYS_BEFORE` dias, em tenant com acesso (`trial`, `active`, `past_due`).
 *
 * Idempotência e falha: `claimTenantNotification` grava a linha e devolve null quando já havia (nada a enviar); depois
 * do envio, `markTenantNotificationSent` preenche `sent_at` e os destinatários. Se o transporte falhou para todos,
 * a linha é apagada (`releaseTenantNotification`) e a próxima rodada tenta de novo. Sem SMTP ou sem destinatário, a
 * linha fica sem `sent_at` (registrado sem entrega) e o log avisa.
 */
import { and, eq, gt, inArray, lte } from 'drizzle-orm';
import type { Catalog } from '@galaxie/billing';
import {
  claimTenantNotification,
  markTenantNotificationSent,
  moduleTrial,
  releaseTenantNotification,
  tenant,
  tenantNotificationAudience,
  type Database,
  type TenantNotificationAudience,
  type TenantNotificationKind,
  type TenantState,
} from '@galaxie/db';
import { renderMail } from './render.js';
import { fill, longDate, MAIL_TEXTS, mailLocale, type MailLocale } from './texts.js';
import { mailLinks, sendMail, type MailLinks, type MailSender } from './transport.js';

const DAY_MS = 86_400_000;

/** O aviso de mudança de estado só sai se a mudança tem até este tanto de dias. */
export const STATE_MAIL_WINDOW_DAYS = 3;

/** Estados com acesso: só neles o teste de um módulo está valendo e o lembrete dele faz sentido. */
export const MODULE_TRIAL_STATES: readonly TenantState[] = ['trial', 'active', 'past_due'];

export interface NotificationSettings {
  /** `TRIAL_REMINDER_DAYS`: dias do trial em que o lembrete sai (ex.: 23 e 29). */
  trialReminderDays: readonly number[];
  /** `MODULE_TRIAL_REMINDER_DAYS_BEFORE`: dias antes do fim do teste de um módulo. */
  moduleTrialReminderDaysBefore: number;
}

export interface NotifiableTenant {
  id: string;
  slug: string;
  state: TenantState;
  stateSince: Date;
  trialEndsAt: Date | null;
}

export interface ModuleTrialDue {
  tenantId: string;
  module: string;
  endsAt: Date;
}

export interface DueNotification {
  tenantId: string;
  kind: TenantNotificationKind;
  ref: string;
  /** false = só registrar (lembrete superado por outro mais tardio), sem enviar. */
  send: boolean;
  /** O que o texto precisa: dia do trial, dias até o prazo, a data e o módulo. */
  vars: { day?: number; days?: number; date: Date; module?: string };
}

/** Dias inteiros entre dois instantes, arredondando para baixo. */
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);
/** Dias até um prazo, arredondando para cima (amanhã de manhã = 1). */
const daysUntil = (now: Date, until: Date) =>
  Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS));

/** `"23,29"` → `[23, 29]` (ordenados, sem repetição, só inteiros positivos). */
export function parseReminderDays(value: string): number[] {
  const days = value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Os e-mails devidos agora para um tenant (puro). `moduleTrials` são só os deste tenant. */
export function dueLifecycleNotifications(
  t: NotifiableTenant,
  now: Date,
  settings: NotificationSettings,
  moduleTrials: readonly ModuleTrialDue[] = [],
): DueNotification[] {
  const due: DueNotification[] = [];
  const recent = daysBetween(t.stateSince, now) <= STATE_MAIL_WINDOW_DAYS;
  switch (t.state) {
    case 'trial': {
      if (!t.trialEndsAt || t.trialEndsAt.getTime() <= now.getTime()) break;
      const day = daysBetween(t.stateSince, now) + 1;
      const reached = settings.trialReminderDays.filter((n) => day >= n).sort((a, b) => a - b);
      const last = reached[reached.length - 1];
      for (const n of reached)
        due.push({
          tenantId: t.id,
          kind: 'trial_reminder',
          ref: String(n),
          send: n === last,
          vars: { day, days: daysUntil(now, t.trialEndsAt), date: t.trialEndsAt },
        });
      break;
    }
    case 'trial_expired':
      if (recent)
        due.push({
          tenantId: t.id,
          kind: 'trial_expired',
          ref: '',
          send: true,
          vars: { date: t.stateSince },
        });
      break;
    case 'suspended':
    case 'cancelled':
      if (recent)
        due.push({
          tenantId: t.id,
          kind: t.state,
          ref: t.stateSince.toISOString(),
          send: true,
          vars: { date: t.stateSince },
        });
      break;
    default:
      break;
  }
  if (MODULE_TRIAL_STATES.includes(t.state)) {
    const limit = now.getTime() + settings.moduleTrialReminderDaysBefore * DAY_MS;
    for (const m of moduleTrials) {
      if (m.tenantId !== t.id || m.endsAt.getTime() <= now.getTime() || m.endsAt.getTime() > limit) continue;
      due.push({
        tenantId: t.id,
        kind: 'module_trial_ending',
        ref: m.module,
        send: true,
        vars: { days: daysUntil(now, m.endsAt), date: m.endsAt, module: m.module },
      });
    }
  }
  return due;
}

/** Quem recebe: Donos e Financeiro com e-mail, um por endereço (minúsculas), na ordem Dono → Financeiro. */
export function recipientEmails(
  members: readonly { email: string | null | undefined; role: string }[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of ['owner', 'billing'])
    for (const m of members) {
      const email = m.email?.trim().toLowerCase();
      if (m.role !== role || !email || seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }
  return out;
}

/** Nome comercial do módulo no catálogo, ou a própria chave. */
export const moduleLabel = (catalog: Pick<Catalog, 'modules'> | null, module: string): string =>
  (catalog?.modules as Record<string, { name?: string }> | undefined)?.[module]?.name ?? module;

/** Monta um e-mail do ciclo de vida para uma pessoa. */
export function composeLifecycleMail(
  due: DueNotification,
  audience: Pick<TenantNotificationAudience, 'tenantName'>,
  person: { email: string; name: string | null },
  locale: MailLocale,
  links: MailLinks,
  moduleName: string | null,
) {
  const t = MAIL_TEXTS[locale];
  const text = t[due.kind as Exclude<TenantNotificationKind, 'welcome'>];
  const vars = {
    brand: audience.tenantName,
    date: longDate(locale, due.vars.date),
    day: due.vars.day ?? '',
    days: due.vars.days ?? '',
    module: moduleName ?? due.vars.module ?? '',
  };
  const subject = fill(due.vars.days === 1 && text.subjectOne ? text.subjectOne : text.subject, vars);
  // o botão leva à loja quando o texto pede e ela está configurada; senão ao console; sem nenhum, sem botão
  const toStore = text.action === 'store' && Boolean(links.store);
  const url = toStore ? links.store : links.console;
  return renderMail({
    locale,
    name: person.name ?? '',
    subject,
    paragraphs: [fill(text.intro, vars), fill(text.body, vars)],
    action: url ? { label: toStore ? t.actions.store : t.actions.console, url } : null,
  });
}

export interface NotificationDeps {
  /** Testes de módulo com prazo até `until`, em tenants com acesso. */
  moduleTrials: (db: Database, now: Date, until: Date) => Promise<(ModuleTrialDue & { slug: string })[]>;
  audience: (db: Database, tenantId: string) => Promise<TenantNotificationAudience | null>;
  claim: typeof claimTenantNotification;
  markSent: typeof markTenantNotificationSent;
  release: typeof releaseTenantNotification;
  send: MailSender;
  links: MailLinks;
  /** Catálogo para o nome do módulo; null = a chave do módulo no texto. */
  catalog: Pick<Catalog, 'modules'> | null;
}

export const pgNotificationDeps = (catalog: Pick<Catalog, 'modules'> | null = null): NotificationDeps => ({
  async moduleTrials(db, now, until) {
    const rows = await db
      .select({
        tenantId: moduleTrial.tenantId,
        slug: tenant.slug,
        module: moduleTrial.module,
        endsAt: moduleTrial.endsAt,
      })
      .from(moduleTrial)
      .innerJoin(tenant, eq(tenant.id, moduleTrial.tenantId))
      .where(
        and(
          gt(moduleTrial.endsAt, now),
          lte(moduleTrial.endsAt, until),
          inArray(tenant.state, [...MODULE_TRIAL_STATES]),
        ),
      )
      .orderBy(moduleTrial.endsAt, moduleTrial.id);
    return rows;
  },
  audience: (db, tenantId) => tenantNotificationAudience(db, tenantId),
  claim: claimTenantNotification,
  markSent: markTenantNotificationSent,
  release: releaseTenantNotification,
  send: (mail) => sendMail(mail),
  links: mailLinks(),
  catalog,
});

export interface NotificationOutcome {
  tenant: string;
  kind: TenantNotificationKind;
  ref: string;
  recipients: number;
}

export interface NotificationReport {
  /** Enviados agora (ao menos um destinatário recebeu). */
  sent: NotificationOutcome[];
  /** Registrados sem entrega: sem SMTP, sem destinatário, ou lembrete superado por outro. */
  registered: NotificationOutcome[];
  /** O transporte falhou: registro apagado, a próxima rodada tenta de novo. */
  failed: (NotificationOutcome & { error: string })[];
}

/**
 * Uma rodada dos e-mails: decide, registra, envia. `tenants` é a lista já com as transições desta rodada aplicadas
 * (quem acabou de virar `trial_expired` recebe hoje). Tenants fora da lista do relógio (`active`) entram só pelos
 * testes de módulo.
 */
export async function sendLifecycleNotifications(
  db: Database,
  tenants: readonly NotifiableTenant[],
  now: Date,
  settings: NotificationSettings,
  deps: NotificationDeps,
): Promise<NotificationReport> {
  const report: NotificationReport = { sent: [], registered: [], failed: [] };
  const until = new Date(now.getTime() + settings.moduleTrialReminderDaysBefore * DAY_MS);
  const trials = await deps.moduleTrials(db, now, until);
  const byTenant = new Map<string, NotifiableTenant>(tenants.map((t) => [t.id, t]));
  // tenants com teste de módulo que o relógio não lista (active): entram só para o lembrete do módulo
  for (const m of trials)
    if (!byTenant.has(m.tenantId))
      byTenant.set(m.tenantId, {
        id: m.tenantId,
        slug: m.slug,
        state: 'active',
        stateSince: now,
        trialEndsAt: null,
      });
  for (const t of byTenant.values()) {
    const due = dueLifecycleNotifications(t, now, settings, trials);
    if (!due.length) continue;
    let audience: TenantNotificationAudience | null | undefined;
    for (const d of due) {
      const id = await deps.claim(db, { tenantId: d.tenantId, kind: d.kind, ref: d.ref });
      if (!id) continue;
      if (audience === undefined) audience = await deps.audience(db, t.id);
      const people = audience?.recipients ?? [];
      const recipients = recipientEmails(people);
      const outcome: NotificationOutcome = {
        tenant: t.slug,
        kind: d.kind,
        ref: d.ref,
        recipients: recipients.length,
      };
      if (!d.send || !audience || !recipients.length) {
        await deps.markSent(db, id, { recipients, delivered: false });
        report.registered.push(outcome);
        continue;
      }
      const locale = mailLocale(audience.locale);
      const moduleName = d.vars.module ? moduleLabel(deps.catalog, d.vars.module) : null;
      let delivered = false;
      let smtpMissing = false;
      let lastError = '';
      for (const person of people) {
        if (!recipients.includes(person.email)) continue;
        const mail = composeLifecycleMail(d, audience, person, locale, deps.links, moduleName);
        const r = await deps.send({ to: [person.email], ...mail });
        if (r.delivered) delivered = true;
        else if (r.error === 'SMTP not configured') smtpMissing = true;
        else lastError = r.error ?? 'erro desconhecido';
      }
      if (delivered) {
        await deps.markSent(db, id, { recipients, delivered: true, at: now });
        report.sent.push(outcome);
      } else if (smtpMissing) {
        await deps.markSent(db, id, { recipients, delivered: false });
        report.registered.push(outcome);
      } else {
        await deps.release(db, id);
        report.failed.push({ ...outcome, error: lastError });
      }
    }
  }
  return report;
}
