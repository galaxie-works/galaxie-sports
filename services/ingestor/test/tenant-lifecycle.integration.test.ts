/**
 * `tenant.lifecycle` contra o banco (plataforma comercial F3): os prazos vêm de `ops.runtime_setting`, as transições
 * passam por `transitionTenantState` (evento, espelho de status, change feed) e os domínios comprovados há mais de 24 h
 * voltam à fila `tenant.verify_domain` com dedupe por id. Rodar de novo não muda nada a mais. Os e-mails do ciclo de
 * vida (decisão 11) ficam registrados em `billing.tenant_notification` antes do envio: a segunda rodada não repete, e
 * a falha do transporte apaga o registro para a próxima tentativa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  claimTenantNotification,
  domain,
  jobRequest,
  moduleTrial,
  organization,
  organizationMember,
  tenant,
  tenantNotification,
  tenantStateEvent,
  writeRuntimeSetting,
  type Database,
} from '@galaxie/db';
import { pgNotificationDeps } from '../src/mail/lifecycle-notifications.js';
import type { OutgoingMail } from '../src/mail/transport.js';
import { pgLifecycleDeps, runTenantLifecycle } from '../src/tasks/lifecycle.js';
import { disposableDb } from './db.js';

const NOW = new Date('2026-11-16T04:15:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const temp = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await temp.setup();
}, 90_000);
afterAll(async () => {
  await temp.teardown();
});

async function newTenant(slug: string, values: Partial<typeof tenant.$inferInsert>) {
  const [t] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'fan_experience', modules: ['core_data'], ...values })
    .returning({ id: tenant.id });
  return t!.id;
}

const stateOf = async (id: string) =>
  (await db.select({ state: tenant.state, status: tenant.status }).from(tenant).where(eq(tenant.id, id)))[0]!;

describe('tenant.lifecycle com o banco', () => {
  it('aplica os prazos do painel, grava os eventos clock e reenfileira os domínios comprovados antigos', async () => {
    // o prazo da inadimplência mudou no painel: 3 dias em vez dos 7 do padrão
    await writeRuntimeSetting(db, { key: 'TENANT_PAST_DUE_DAYS', value: '3', valueType: 'int', by: 'teste' });
    const trialVencido = await newTenant('lc-trial-vencido', {
      state: 'trial',
      stateSince: daysAgo(31),
      trialEndsAt: daysAgo(1),
    });
    const trialEmCurso = await newTenant('lc-trial-em-curso', {
      state: 'trial',
      stateSince: daysAgo(2),
      trialEndsAt: daysAgo(-28),
    });
    const pastDue = await newTenant('lc-past-due', { state: 'past_due', stateSince: daysAgo(4) });
    const suspensoRecente = await newTenant('lc-suspenso', {
      state: 'suspended',
      status: 'suspended',
      stateSince: daysAgo(10),
    });
    const expiradoAntigo = await newTenant('lc-expirado', {
      state: 'trial_expired',
      stateSince: daysAgo(61),
    });
    const cancelado = await newTenant('lc-cancelado', { state: 'cancelled', stateSince: daysAgo(95) });
    const ativo = await newTenant('lc-ativo', { state: 'active', stateSince: daysAgo(500) });
    const [staleDomain] = await db
      .insert(domain)
      .values({
        tenantId: ativo,
        host: 'antigo.exemplo.com',
        verifiedAt: daysAgo(30),
        lastCheckedAt: daysAgo(2),
        createdBy: 'teste',
      })
      .returning({ id: domain.id });
    await db.insert(domain).values({
      tenantId: ativo,
      host: 'recente.exemplo.com',
      verifiedAt: daysAgo(30),
      lastCheckedAt: new Date(NOW.getTime() - 60_000),
      createdBy: 'teste',
    });
    await db.insert(domain).values({ tenantId: ativo, host: 'pendente.exemplo.com', createdBy: 'teste' });

    const report = await runTenantLifecycle(db, pgLifecycleDeps, NOW);
    expect(report.settings).toMatchObject({ pastDueDays: 3, trialExpiredDays: 60 });
    expect(report.transitions.map((t) => `${t.tenant}: ${t.from} → ${t.to}`).sort()).toEqual([
      'lc-expirado: trial_expired → cancelled',
      'lc-past-due: past_due → suspended',
      'lc-trial-vencido: trial → trial_expired',
    ]);
    expect(report.refused).toEqual([]);
    expect(report.retentionExpired).toEqual(['lc-cancelado']);
    expect(report.domainsRechecked).toBe(1);

    expect(await stateOf(trialVencido)).toEqual({ state: 'trial_expired', status: 'active' });
    expect(await stateOf(trialEmCurso)).toEqual({ state: 'trial', status: 'active' });
    expect(await stateOf(pastDue)).toEqual({ state: 'suspended', status: 'suspended' });
    expect(await stateOf(suspensoRecente)).toEqual({ state: 'suspended', status: 'suspended' });
    expect(await stateOf(expiradoAntigo)).toEqual({ state: 'cancelled', status: 'active' });
    expect(await stateOf(cancelado)).toEqual({ state: 'cancelled', status: 'active' });

    const events = await db
      .select({ to: tenantStateEvent.toState, cause: tenantStateEvent.cause, actor: tenantStateEvent.actor })
      .from(tenantStateEvent)
      .where(eq(tenantStateEvent.tenantId, pastDue));
    expect(events).toEqual([{ to: 'suspended', cause: 'clock', actor: 'job:tenant.lifecycle' }]);

    const queued = await db
      .select({ type: jobRequest.type, dedupeKey: jobRequest.dedupeKey, requestedBy: jobRequest.requestedBy })
      .from(jobRequest)
      .where(eq(jobRequest.type, 'tenant.verify_domain'));
    expect(queued).toEqual([
      { type: 'tenant.verify_domain', dedupeKey: staleDomain!.id, requestedBy: 'job:tenant.lifecycle' },
    ]);

    // idempotente: a segunda rodada do mesmo instante não muda nada nem enfileira de novo
    const again = await runTenantLifecycle(db, pgLifecycleDeps, NOW);
    expect(again.transitions).toEqual([]);
    expect(again.domainsRechecked).toBe(0);
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from billing.tenant_state_event where cause = 'clock'`,
    );
    expect(rows[0]!.n).toBe(3);
    // tenants sem organização: os avisos ficam registrados sem destinatário, nunca enviados
    expect(report.notifications.sent).toEqual([]);
    expect(report.notifications.registered.map((n) => `${n.tenant}: ${n.kind}`).sort()).toEqual([
      'lc-expirado: cancelled',
      'lc-past-due: suspended',
      'lc-trial-em-curso: welcome',
      'lc-trial-vencido: trial_expired',
    ]);
    expect(report.mailError).toBeNull();
  });

  it('manda os e-mails do ciclo de vida aos Donos e ao Financeiro uma vez só; a falha do envio volta à fila', async () => {
    // o schema do console (Better Auth) não vem das migrations: só a tabela `user` que a leitura dos destinatários usa
    await db.execute(sql`create schema if not exists demo_auth`);
    await db.execute(
      sql`create table if not exists demo_auth."user" (id text primary key, email text not null, name text)`,
    );
    await db.execute(sql`insert into demo_auth."user" (id, email, name) values
      ('u-dono', 'Dono@Exemplo.test', 'Ana Lima'), ('u-fin', 'fin@exemplo.test', 'Bia'), ('u-dev', 'dev@exemplo.test', 'Caio')`);
    const [org] = await db
      .insert(organization)
      .values({
        slug: 'org-mail',
        name: 'Org Mail',
        country: 'US',
        currency: 'usd',
        billingEntity: 'llc',
        locale: 'en',
        createdBy: 'teste',
      })
      .returning({ id: organization.id });
    await db.execute(
      sql`insert into demo_auth."user" (id, email, name) values ('u-vencido', 'vencido@exemplo.test', 'Dé')`,
    );
    await db.insert(organizationMember).values([
      { organizationId: org!.id, userId: 'u-dono', role: 'owner', invitedBy: 'teste', acceptedAt: NOW },
      // convite pendente dentro do prazo: recebe
      {
        organizationId: org!.id,
        userId: 'u-fin',
        role: 'billing',
        invitedBy: 'teste',
        expiresAt: daysAgo(-3),
      },
      // convite vencido sem aceite: não recebe
      {
        organizationId: org!.id,
        userId: 'u-vencido',
        role: 'billing',
        invitedBy: 'teste',
        expiresAt: daysAgo(1),
      },
    ]);
    // dia 23 do trial (state_since há 22 dias), prazo em 8 dias
    const dia23 = await newTenant('mail-dia-23', {
      organizationId: org!.id,
      state: 'trial',
      stateSince: daysAgo(22),
      trialEndsAt: daysAgo(-8),
    });
    // vence hoje: trial → trial_expired na mesma rodada, e o aviso sai já
    const vence = await newTenant('mail-vence', {
      organizationId: org!.id,
      state: 'trial',
      stateSince: daysAgo(30),
      trialEndsAt: daysAgo(0.5),
    });
    // ativo com teste de módulo acabando amanhã (o relógio não lista active; o lembrete do módulo entra mesmo assim)
    const ativo = await newTenant('mail-ativo', {
      organizationId: org!.id,
      state: 'active',
      stateSince: daysAgo(90),
    });
    await db.insert(moduleTrial).values({
      organizationId: org!.id,
      tenantId: ativo,
      module: 'live_chat',
      startedAt: daysAgo(13),
      endsAt: daysAgo(-1),
      startedBy: 'teste',
    });
    // entrou em trial ontem e o console não conseguiu mandar as boas-vindas: o relógio manda
    const novo = await newTenant('mail-novo', {
      organizationId: org!.id,
      state: 'trial',
      stateSince: daysAgo(1),
      trialEndsAt: daysAgo(-29),
    });
    // suspenso há muito tempo: aviso fora da janela, nada sai
    await newTenant('mail-suspenso-antigo', {
      organizationId: org!.id,
      state: 'suspended',
      status: 'suspended',
      stateSince: daysAgo(10),
    });

    const sent: OutgoingMail[] = [];
    let mode: 'ok' | 'fail' | 'no-smtp' = 'ok';
    const deps = {
      ...pgLifecycleDeps,
      notifications: {
        ...pgNotificationDeps(null),
        links: { console: 'https://console.example/client', store: 'https://console.example/client/plans' },
        send: async (mail: OutgoingMail) => {
          if (mode === 'fail') return { delivered: false, error: 'conexão recusada' };
          if (mode === 'no-smtp') return { delivered: false, error: 'SMTP not configured' };
          sent.push(mail);
          return { delivered: true };
        },
      },
    };
    const expectedFailed = [
      'mail-ativo: module_trial_ending',
      'mail-dia-23: trial_reminder',
      'mail-novo: welcome',
      'mail-vence: trial_expired',
    ];

    mode = 'fail';
    const r1 = await runTenantLifecycle(db, deps, NOW);
    expect(r1.transitions).toEqual([{ tenant: 'mail-vence', from: 'trial', to: 'trial_expired' }]);
    expect(r1.mailError).toBeNull();
    expect(r1.notifications.sent).toEqual([]);
    expect(r1.notifications.failed.map((n) => `${n.tenant}: ${n.kind}`).sort()).toEqual(expectedFailed);
    // nada registrado: a próxima rodada tenta de novo
    const mine = (rows: { tenantId: string }[]) =>
      rows.filter((n) => [dia23, vence, ativo, novo].includes(n.tenantId));
    expect(mine(await db.select().from(tenantNotification))).toEqual([]);

    // sem SMTP é falha também (o registro sai), não "registrado sem entrega"
    mode = 'no-smtp';
    const r1b = await runTenantLifecycle(db, deps, NOW);
    expect(r1b.notifications.failed.map((n) => `${n.tenant}: ${n.kind}`).sort()).toEqual(expectedFailed);
    expect(r1b.notifications.failed.every((n) => n.error === 'SMTP not configured')).toBe(true);
    expect(mine(await db.select().from(tenantNotification))).toEqual([]);

    mode = 'ok';
    const r2 = await runTenantLifecycle(db, deps, NOW);
    expect(r2.notifications.failed).toEqual([]);
    expect(
      r2.notifications.sent.map((n) => `${n.tenant}: ${n.kind} ${n.ref} → ${n.recipients}`).sort(),
    ).toEqual([
      'mail-ativo: module_trial_ending live_chat → 2',
      'mail-dia-23: trial_reminder 23 → 2',
      'mail-novo: welcome  → 2',
      'mail-vence: trial_expired  → 2',
    ]);
    // um e-mail por pessoa, Dono e Financeiro (convite vencido não recebe), em inglês (locale da organização)
    const to = sent.flatMap((m) => m.to).sort();
    expect(to).toEqual([
      ...Array<string>(4).fill('dono@exemplo.test'),
      ...Array<string>(4).fill('fin@exemplo.test'),
    ]);
    expect(sent.find((m) => m.subject.startsWith('Welcome'))?.text).toContain('1. First call');
    const reminder = sent.find((m) => m.subject.includes("mail-dia-23's trial ends"));
    expect(reminder?.subject).toBe("mail-dia-23's trial ends in 8 days");
    expect(reminder?.text).toContain('day 23');
    expect(reminder?.text).toContain('See plans and modules: https://console.example/client/plans');
    expect(sent.some((m) => m.subject === "mail-vence's trial has ended")).toBe(true);
    expect(sent.some((m) => m.subject === 'The live_chat module trial ends tomorrow')).toBe(true);

    const rows = await db
      .select({
        tenantId: tenantNotification.tenantId,
        kind: tenantNotification.kind,
        ref: tenantNotification.ref,
        sentAt: tenantNotification.sentAt,
        recipients: tenantNotification.recipients,
      })
      .from(tenantNotification)
      .where(eq(tenantNotification.tenantId, dia23));
    expect(rows).toEqual([
      {
        tenantId: dia23,
        kind: 'trial_reminder',
        ref: '23',
        sentAt: NOW,
        recipients: ['dono@exemplo.test', 'fin@exemplo.test'],
      },
    ]);

    // a terceira rodada não repete nada
    const r3 = await runTenantLifecycle(db, deps, NOW);
    expect(r3.notifications).toEqual({ sent: [], registered: [], failed: [] });
    expect(sent).toHaveLength(8);

    // dois claims ao mesmo tempo da mesma chave: um passa, o outro recebe null
    const claims = await Promise.all([
      claimTenantNotification(db, { tenantId: novo, kind: 'trial_reminder', ref: '99' }),
      claimTenantNotification(db, { tenantId: novo, kind: 'trial_reminder', ref: '99' }),
    ]);
    expect(claims.filter((c) => c !== null)).toHaveLength(1);

    // seis dias depois (dia 29) sai o lembrete 29, e só ele; o convite do Financeiro venceu no dia 26 (relógio do job)
    const r4 = await runTenantLifecycle(db, deps, new Date(NOW.getTime() + 6 * 86_400_000));
    expect(r4.notifications.sent.map((n) => `${n.tenant}: ${n.kind} ${n.ref} → ${n.recipients}`)).toEqual([
      'mail-dia-23: trial_reminder 29 → 1',
    ]);
    expect(sent.at(-1)?.to).toEqual(['dono@exemplo.test']);
    expect(sent.at(-1)?.subject).toBe("mail-dia-23's trial ends in 2 days");
  });
});
