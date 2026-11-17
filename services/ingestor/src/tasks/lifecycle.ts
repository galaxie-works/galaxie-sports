/**
 * `tenant.lifecycle` (plataforma comercial F3, doc 02 §Máquina de estados do tenant; brief, decisão 5): o relógio da
 * máquina de estados, uma vez por dia. Lê os prazos de `ops.runtime_setting` (PL15: nunca número fixo no código) e
 * aplica, com causa `clock` e ator `job:tenant.lifecycle`:
 *
 * - `trial` com `trial_ends_at <= agora` → `trial_expired`;
 * - `trial_expired` há mais de `TENANT_TRIAL_EXPIRED_DAYS` → `cancelled`;
 * - `past_due` há mais de `TENANT_PAST_DUE_DAYS` → `suspended`;
 * - `suspended` há mais de `TENANT_SUSPENDED_DAYS` → `cancelled`;
 * - `cancelled` há mais de `TENANT_CANCELLED_RETENTION_DAYS`: só conta (o aviso no painel); o produto não apaga nada
 *   sem decisão do dono.
 *
 * Depois das transições, manda os e-mails do ciclo de vida (decisão 11; `../mail/lifecycle-notifications.ts`): lembretes
 * do trial nos dias de `TRIAL_REMINDER_DAYS`, trial vencido, teste de módulo acabando (`MODULE_TRIAL_REMINDER_DAYS_BEFORE`
 * dias antes), suspensão e cancelamento, registrados em `billing.tenant_notification` antes do envio (idempotência).
 * E reenfileira `tenant.verify_domain` (`dedupe_key` = id do domínio) para cada domínio comprovado conferido há mais de
 * 24 h: a reconferência diária da decisão 12. Idempotente: a segunda rodada do dia não encontra nada a mudar nem a
 * enviar.
 */
import { and, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { transitionTenantState, TenantStateError } from '@galaxie/billing';
import { domain, readRuntimeOverrides, tenant, type Database, type TenantState } from '@galaxie/db';
import { enqueue } from '@galaxie/db/queue';
import { TENANT_VERIFY_DOMAIN } from '@galaxie/db/queue-types';
import { resolveSetting, settingDef } from '@galaxie/runtime-config';
import {
  parseReminderDays,
  pgNotificationDeps,
  sendLifecycleNotifications,
  type NotificationDeps,
  type NotificationReport,
  type NotificationSettings,
} from '../mail/lifecycle-notifications.js';
import type { TaskHandler } from './run.js';

export const LIFECYCLE_ACTOR = 'job:tenant.lifecycle';

/** Domínio comprovado conferido há mais que isto volta à fila. */
export const DOMAIN_RECHECK_MS = 24 * 60 * 60_000;

const DAY_MS = 86_400_000;

/**
 * Prazos do ciclo de vida (dias) e os dias dos e-mails, lidos de `runtime_setting` com a precedência do painel
 * (banco > env > padrão).
 */
export interface LifecycleSettings extends NotificationSettings {
  trialExpiredDays: number;
  pastDueDays: number;
  suspendedDays: number;
  cancelledRetentionDays: number;
}

export const LIFECYCLE_SETTING_KEYS = {
  trialExpiredDays: 'TENANT_TRIAL_EXPIRED_DAYS',
  pastDueDays: 'TENANT_PAST_DUE_DAYS',
  suspendedDays: 'TENANT_SUSPENDED_DAYS',
  cancelledRetentionDays: 'TENANT_CANCELLED_RETENTION_DAYS',
  trialReminderDays: 'TRIAL_REMINDER_DAYS',
  moduleTrialReminderDaysBefore: 'MODULE_TRIAL_REMINDER_DAYS_BEFORE',
} as const;

/** Resolve os prazos a partir das sobrescritas do painel e do env (puro; `readLifecycleSettings` lê o banco). */
export function resolveLifecycleSettings(
  overrides: ReadonlyMap<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): LifecycleSettings {
  const raw = (key: string): string => {
    const def = settingDef(key);
    if (!def) throw new Error(`Chave ${key} não está no registro do painel.`);
    return String(resolveSetting(def, { overrides, env: (k) => env[k] }).value ?? def.default);
  };
  const read = (key: string): number => {
    const value = raw(key);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0)
      throw new Error(`${key} precisa ser um inteiro ≥ 0 (recebido: ${value}).`);
    return n;
  };
  return {
    trialExpiredDays: read(LIFECYCLE_SETTING_KEYS.trialExpiredDays),
    pastDueDays: read(LIFECYCLE_SETTING_KEYS.pastDueDays),
    suspendedDays: read(LIFECYCLE_SETTING_KEYS.suspendedDays),
    cancelledRetentionDays: read(LIFECYCLE_SETTING_KEYS.cancelledRetentionDays),
    trialReminderDays: parseReminderDays(raw(LIFECYCLE_SETTING_KEYS.trialReminderDays)),
    moduleTrialReminderDaysBefore: read(LIFECYCLE_SETTING_KEYS.moduleTrialReminderDaysBefore),
  };
}

export async function readLifecycleSettings(db: Database, env: NodeJS.ProcessEnv = process.env) {
  return resolveLifecycleSettings(await readRuntimeOverrides(db), env);
}

/** O que a tarefa lê de cada tenant que pode mudar pelo relógio. */
export interface LifecycleTenant {
  id: string;
  slug: string;
  state: TenantState;
  stateSince: Date;
  trialEndsAt: Date | null;
}

/** Estados que o relógio toca (os demais mudam só por cadastro, revisão, pagamento ou ação da equipe). */
export const CLOCK_STATES: readonly TenantState[] = [
  'trial',
  'trial_expired',
  'past_due',
  'suspended',
  'cancelled',
];

export interface DueTransition {
  to: TenantState;
  reason: string;
  payload: Record<string, unknown>;
}

const daysIn = (since: Date, now: Date) => Math.floor((now.getTime() - since.getTime()) / DAY_MS);

/**
 * A transição que o relógio deve fazer agora para este tenant (puro), ou null. `cancelled` com a guarda vencida devolve
 * null também: é aviso, não transição (`retentionExpired`).
 */
export function dueTransition(t: LifecycleTenant, now: Date, s: LifecycleSettings): DueTransition | null {
  const days = daysIn(t.stateSince, now);
  switch (t.state) {
    case 'trial':
      return t.trialEndsAt && t.trialEndsAt.getTime() <= now.getTime()
        ? {
            to: 'trial_expired',
            reason: 'prazo do trial vencido (trial_ends_at)',
            payload: { trial_ends_at: t.trialEndsAt.toISOString() },
          }
        : null;
    case 'trial_expired':
      return days >= s.trialExpiredDays
        ? {
            to: 'cancelled',
            reason: `${days} dias em trial_expired (TENANT_TRIAL_EXPIRED_DAYS = ${s.trialExpiredDays})`,
            payload: { state_since: t.stateSince.toISOString(), days, limit_days: s.trialExpiredDays },
          }
        : null;
    case 'past_due':
      return days >= s.pastDueDays
        ? {
            to: 'suspended',
            reason: `${days} dias em past_due (TENANT_PAST_DUE_DAYS = ${s.pastDueDays})`,
            payload: { state_since: t.stateSince.toISOString(), days, limit_days: s.pastDueDays },
          }
        : null;
    case 'suspended':
      return days >= s.suspendedDays
        ? {
            to: 'cancelled',
            reason: `${days} dias em suspended (TENANT_SUSPENDED_DAYS = ${s.suspendedDays})`,
            payload: { state_since: t.stateSince.toISOString(), days, limit_days: s.suspendedDays },
          }
        : null;
    default:
      return null;
  }
}

/** A guarda depois de `cancelled` venceu? (só aviso: nada é apagado) */
export const retentionExpired = (t: LifecycleTenant, now: Date, s: LifecycleSettings): boolean =>
  t.state === 'cancelled' && daysIn(t.stateSince, now) >= s.cancelledRetentionDays;

export interface LifecycleDeps {
  settings: (db: Database) => Promise<LifecycleSettings>;
  listTenants: (db: Database) => Promise<LifecycleTenant[]>;
  transition: (
    db: Database,
    tenantId: string,
    to: TenantState,
    input: { reason: string; payload: Record<string, unknown>; now: Date },
  ) => Promise<void>;
  /** Domínios comprovados cuja última conferência é anterior a `before` (ou nunca conferidos). */
  staleDomains: (db: Database, before: Date) => Promise<{ id: string; host: string }[]>;
  enqueueVerify: (db: Database, domainId: string) => Promise<{ created: boolean }>;
  /** E-mails do ciclo de vida (decisão 11); null desliga (ensaios que só olham as transições). */
  notifications: NotificationDeps | null;
  now?: () => Date;
}

export const pgLifecycleDeps: Omit<LifecycleDeps, 'now'> = {
  settings: (db) => readLifecycleSettings(db),
  notifications: pgNotificationDeps(),
  async listTenants(db) {
    return db
      .select({
        id: tenant.id,
        slug: tenant.slug,
        state: tenant.state,
        stateSince: tenant.stateSince,
        trialEndsAt: tenant.trialEndsAt,
      })
      .from(tenant)
      .where(inArray(tenant.state, [...CLOCK_STATES]))
      .orderBy(tenant.stateSince, tenant.id);
  },
  async transition(db, tenantId, to, input) {
    await transitionTenantState(db, tenantId, to, {
      cause: 'clock',
      actor: LIFECYCLE_ACTOR,
      reason: input.reason,
      payload: input.payload,
      now: input.now,
    });
  },
  async staleDomains(db, before) {
    return db
      .select({ id: domain.id, host: domain.host })
      .from(domain)
      .where(
        and(isNotNull(domain.verifiedAt), or(isNull(domain.lastCheckedAt), lt(domain.lastCheckedAt, before))),
      )
      .orderBy(sql`${domain.lastCheckedAt} nulls first`, domain.id);
  },
  async enqueueVerify(db, domainId) {
    const r = await enqueue(db, {
      type: TENANT_VERIFY_DOMAIN.type,
      params: { domainId },
      dedupeKey: domainId,
      maxAttempts: TENANT_VERIFY_DOMAIN.maxAttempts ?? 3,
      requestedBy: LIFECYCLE_ACTOR,
    });
    return { created: r.created };
  },
};

export interface LifecycleReport {
  now: string;
  settings: LifecycleSettings;
  examined: number;
  transitions: { tenant: string; from: TenantState; to: TenantState }[];
  /** Transições recusadas pela máquina de estados (outro processo mudou o tenant no meio): registradas, sem falhar. */
  refused: { tenant: string; error: string }[];
  /** Tenants cancelados com a guarda vencida: o aviso; nada foi apagado. */
  retentionExpired: string[];
  domainsRechecked: number;
  /** E-mails desta rodada (decisão 11). */
  notifications: NotificationReport;
}

/** Uma rodada do relógio (a CLI e a tarefa da fila chamam esta função). */
export async function runTenantLifecycle(
  db: Database,
  deps: LifecycleDeps,
  now?: Date,
): Promise<LifecycleReport> {
  const at = now ?? deps.now?.() ?? new Date();
  const settings = await deps.settings(db);
  const tenants = await deps.listTenants(db);
  const report: LifecycleReport = {
    now: at.toISOString(),
    settings,
    examined: tenants.length,
    transitions: [],
    refused: [],
    retentionExpired: [],
    domainsRechecked: 0,
    notifications: { sent: [], registered: [], failed: [] },
  };
  for (const t of tenants) {
    if (retentionExpired(t, at, settings)) report.retentionExpired.push(t.slug);
    const due = dueTransition(t, at, settings);
    if (!due) continue;
    try {
      await deps.transition(db, t.id, due.to, { reason: due.reason, payload: due.payload, now: at });
      report.transitions.push({ tenant: t.slug, from: t.state, to: due.to });
      // a lista em memória acompanha o banco: quem acabou de vencer recebe o e-mail nesta rodada
      t.state = due.to;
      t.stateSince = at;
    } catch (err) {
      if (!(err instanceof TenantStateError)) throw err;
      report.refused.push({ tenant: t.slug, error: err.message });
    }
  }
  if (deps.notifications)
    report.notifications = await sendLifecycleNotifications(db, tenants, at, settings, deps.notifications);
  for (const d of await deps.staleDomains(db, new Date(at.getTime() - DOMAIN_RECHECK_MS))) {
    const r = await deps.enqueueVerify(db, d.id);
    if (r.created) report.domainsRechecked += 1;
  }
  return report;
}

export function tenantLifecycle(deps: LifecycleDeps = pgLifecycleDeps): TaskHandler {
  return async ({ db, params, save: checkpoint, checkStop }) => {
    checkStop();
    const now = typeof params.now === 'string' ? new Date(params.now) : (deps.now?.() ?? new Date());
    const report = await runTenantLifecycle(db, deps, now);
    const log = [
      `${report.examined} tenant(s) no relógio; ${report.transitions.length} transição(ões)`,
      ...report.transitions.map((t) => `${t.tenant}: ${t.from} → ${t.to}`),
      ...report.refused.map((r) => `${r.tenant}: recusada (${r.error})`),
      ...(report.retentionExpired.length
        ? [`guarda vencida (nada apagado): ${report.retentionExpired.join(', ')}`]
        : []),
      `${report.domainsRechecked} domínio(s) de volta à conferência`,
      `${report.notifications.sent.length} e-mail(s) enviado(s), ${report.notifications.registered.length} registrado(s) sem entrega, ${report.notifications.failed.length} com falha`,
      ...report.notifications.sent.map(
        (n) => `${n.tenant}: ${n.kind}${n.ref ? ` ${n.ref}` : ''} → ${n.recipients}`,
      ),
      ...report.notifications.failed.map((n) => `${n.tenant}: ${n.kind} falhou (${n.error})`),
    ];
    await checkpoint({ log, progresso: { feitos: report.examined, total: report.examined } });
    return {
      detail: `${report.transitions.length} transição(ões), ${report.notifications.sent.length} e-mail(s), ${report.domainsRechecked} domínio(s) reconferido(s)`,
      stats: {
        examinados: report.examined,
        transicoes: report.transitions.length,
        recusadas: report.refused.length,
        guardaVencida: report.retentionExpired.length,
        dominiosReconferidos: report.domainsRechecked,
        emailsEnviados: report.notifications.sent.length,
        emailsRegistrados: report.notifications.registered.length,
        emailsComFalha: report.notifications.failed.length,
      },
    };
  };
}
