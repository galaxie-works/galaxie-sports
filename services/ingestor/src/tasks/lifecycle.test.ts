/**
 * `tenant.lifecycle` com banco falso: as transições por prazo (doc 02, PL15), a guarda vencida que só avisa, a recusa
 * da máquina de estados que não derruba a tarefa e a reconferência diária dos domínios comprovados.
 */
import { describe, expect, it } from 'vitest';
import { TenantStateError } from '@galaxie/billing';
import type { Database, TenantState } from '@galaxie/db';
import type { QueueTask } from '@galaxie/db/queue';
import {
  CLOCK_STATES,
  dueTransition,
  resolveLifecycleSettings,
  retentionExpired,
  runTenantLifecycle,
  tenantLifecycle,
  type LifecycleDeps,
  type LifecycleSettings,
  type LifecycleTenant,
} from './lifecycle.js';
import type { TaskContext } from './run.js';

const NOW = new Date('2026-11-16T04:15:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const settings: LifecycleSettings = {
  trialExpiredDays: 60,
  pastDueDays: 7,
  suspendedDays: 30,
  cancelledRetentionDays: 90,
  trialReminderDays: [23, 29],
  moduleTrialReminderDaysBefore: 2,
};

let seq = 0;
const tenantRow = (
  state: TenantState,
  since: Date,
  over: Partial<LifecycleTenant> = {},
): LifecycleTenant => ({
  id: `t-${++seq}`,
  slug: `${state}-${seq}`,
  state,
  stateSince: since,
  trialEndsAt: null,
  ...over,
});

function world(tenants: LifecycleTenant[], domains: { id: string; host: string }[] = []) {
  const transitions: { tenantId: string; to: TenantState; reason: string }[] = [];
  const enqueued: string[] = [];
  const deps: LifecycleDeps = {
    settings: async () => settings,
    listTenants: async () => tenants,
    transition: async (_db, tenantId, to, input) => {
      if (tenantId === 'recusa') throw new TenantStateError('invalid_transition', tenantId, 'active', to);
      transitions.push({ tenantId, to, reason: input.reason });
    },
    staleDomains: async () => domains,
    enqueueVerify: async (_db, id) => {
      const created = !enqueued.includes(id);
      enqueued.push(id);
      return { created };
    },
    // os e-mails têm teste próprio (../mail/lifecycle-notifications.test.ts e o de integração)
    notifications: null,
    now: () => NOW,
  };
  return { deps, transitions, enqueued };
}

describe('dueTransition (puro)', () => {
  it('trial: só com o prazo vencido vira trial_expired', () => {
    expect(
      dueTransition(tenantRow('trial', daysAgo(10), { trialEndsAt: daysAgo(1) }), NOW, settings),
    ).toMatchObject({
      to: 'trial_expired',
    });
    expect(
      dueTransition(tenantRow('trial', daysAgo(10), { trialEndsAt: daysAgo(-1) }), NOW, settings),
    ).toBeNull();
    expect(dueTransition(tenantRow('trial', daysAgo(400)), NOW, settings)).toBeNull();
  });

  it('trial_expired, past_due e suspended: no dia do prazo (>=), com o prazo lido do ajuste', () => {
    expect(dueTransition(tenantRow('trial_expired', daysAgo(60)), NOW, settings)).toMatchObject({
      to: 'cancelled',
    });
    expect(dueTransition(tenantRow('trial_expired', daysAgo(59)), NOW, settings)).toBeNull();
    expect(dueTransition(tenantRow('past_due', daysAgo(7)), NOW, settings)).toMatchObject({
      to: 'suspended',
      reason: '7 dias em past_due (TENANT_PAST_DUE_DAYS = 7)',
    });
    expect(dueTransition(tenantRow('past_due', daysAgo(6)), NOW, settings)).toBeNull();
    expect(dueTransition(tenantRow('suspended', daysAgo(30)), NOW, settings)).toMatchObject({
      to: 'cancelled',
    });
    expect(dueTransition(tenantRow('suspended', daysAgo(29)), NOW, settings)).toBeNull();
    // o prazo mudou no painel: vale o novo
    expect(
      dueTransition(tenantRow('past_due', daysAgo(6)), NOW, { ...settings, pastDueDays: 3 }),
    ).toMatchObject({
      to: 'suspended',
    });
  });

  it('cancelled nunca muda pelo relógio; a guarda vencida é só aviso; os demais estados ficam fora', () => {
    const old = tenantRow('cancelled', daysAgo(91));
    expect(dueTransition(old, NOW, settings)).toBeNull();
    expect(retentionExpired(old, NOW, settings)).toBe(true);
    expect(retentionExpired(tenantRow('cancelled', daysAgo(89)), NOW, settings)).toBe(false);
    expect(retentionExpired(tenantRow('suspended', daysAgo(400)), NOW, settings)).toBe(false);
    for (const state of ['draft', 'pending_review', 'rejected', 'active'] as const) {
      expect(CLOCK_STATES).not.toContain(state);
      expect(dueTransition(tenantRow(state, daysAgo(1000)), NOW, settings)).toBeNull();
    }
  });
});

describe('resolveLifecycleSettings', () => {
  it('padrões do registro, sobrescrita do painel por cima do env', () => {
    expect(resolveLifecycleSettings(new Map(), {})).toEqual(settings);
    expect(
      resolveLifecycleSettings(new Map([['TENANT_PAST_DUE_DAYS', '10']]), { TENANT_PAST_DUE_DAYS: '3' })
        .pastDueDays,
    ).toBe(10);
    expect(resolveLifecycleSettings(new Map(), { TENANT_SUSPENDED_DAYS: '45' }).suspendedDays).toBe(45);
  });
});

describe('runTenantLifecycle e a tarefa', () => {
  it('aplica as transições devidas, registra a recusa sem falhar e reenfileira os domínios', async () => {
    const w = world(
      [
        tenantRow('trial', daysAgo(31), { trialEndsAt: daysAgo(1) }),
        tenantRow('trial', daysAgo(2), { trialEndsAt: daysAgo(-28) }),
        tenantRow('past_due', daysAgo(8)),
        { ...tenantRow('suspended', daysAgo(31)), id: 'recusa', slug: 'recusa' },
        tenantRow('cancelled', daysAgo(100)),
      ],
      [
        { id: 'd1', host: 'a.exemplo.com' },
        { id: 'd2', host: 'b.exemplo.com' },
        { id: 'd1', host: 'a.exemplo.com' },
      ],
    );
    const report = await runTenantLifecycle({} as Database, w.deps);
    expect(report.examined).toBe(5);
    expect(report.transitions.map((t) => `${t.from}→${t.to}`)).toEqual([
      'trial→trial_expired',
      'past_due→suspended',
    ]);
    expect(w.transitions.map((t) => t.to)).toEqual(['trial_expired', 'suspended']);
    expect(report.refused).toEqual([
      { tenant: 'recusa', error: expect.stringContaining('Transição inválida') },
    ]);
    expect(report.retentionExpired).toHaveLength(1);
    // dedupe: o mesmo domínio duas vezes só entra uma
    expect(report.domainsRechecked).toBe(2);
    expect(w.enqueued).toEqual(['d1', 'd2', 'd1']);
  });

  it('a tarefa da fila usa params.now, grava o log no checkpoint e devolve as contagens', async () => {
    const w = world([tenantRow('trial', daysAgo(40), { trialEndsAt: new Date('2026-11-10T00:00:00Z') })]);
    const saved: unknown[] = [];
    const ctx = {
      db: {} as Database,
      task: { id: 't' } as QueueTask,
      params: { now: '2026-11-09T00:00:00Z' },
      previa: false,
      previaId: null,
      checkpoint: null,
      save: async (data: unknown) => {
        saved.push(data);
      },
      signal: new AbortController().signal,
      checkStop: () => {},
    } as TaskContext;
    // em 09/11 o trial ainda não venceu: nada muda
    const before = await tenantLifecycle(w.deps)(ctx);
    expect(before.stats).toMatchObject({ examinados: 1, transicoes: 0, dominiosReconferidos: 0 });
    // em 16/11 venceu
    const after = await tenantLifecycle(w.deps)({ ...ctx, params: {} });
    expect(after.stats).toMatchObject({ examinados: 1, transicoes: 1, recusadas: 0, guardaVencida: 0 });
    expect(saved[1]).toMatchObject({
      log: expect.arrayContaining([expect.stringContaining('trial → trial_expired')]),
    });
  });
});
