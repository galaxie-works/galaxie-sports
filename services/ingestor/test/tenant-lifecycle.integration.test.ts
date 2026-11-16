/**
 * `tenant.lifecycle` contra o banco (plataforma comercial F3): os prazos vêm de `ops.runtime_setting`, as transições
 * passam por `transitionTenantState` (evento, espelho de status, change feed) e os domínios comprovados há mais de 24 h
 * voltam à fila `tenant.verify_domain` com dedupe por id. Rodar de novo não muda nada a mais.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  domain,
  jobRequest,
  tenant,
  tenantStateEvent,
  writeRuntimeSetting,
  type Database,
} from '@galaxie/db';
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
  });
});
