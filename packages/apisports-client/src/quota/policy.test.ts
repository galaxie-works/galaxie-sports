import { describe, expect, it } from 'vitest';
import { InMemoryQuotaGovernor } from './governor.js';
import { decide, defaultPolicy, emptyUsage } from './policy.js';
import { QuotaExceededError } from '../errors.js';
import type { Priority } from '../types.js';

const policy = defaultPolicy(100, 15);

describe('decide', () => {
  it('permite dentro da fatia da prioridade', () => {
    const d = decide(policy, { used: emptyUsage() }, 'DAILY');
    expect(d).toMatchObject({ allow: true, borrowed: false });
  });

  it('nunca ultrapassa limite − reserva; LIVE crítico pode usar a reserva', () => {
    const used = { ...emptyUsage(), DAILY: 45, LIVE: 40 };
    expect(decide(policy, { used }, 'LIVE').allow).toBe(false);
    expect(decide(policy, { used }, 'LIVE', { critical: true }).allow).toBe(true);
    expect(decide(policy, { used: { ...used, LIVE: 55 } }, 'LIVE', { critical: true }).allow).toBe(false);
  });

  it('BOOTSTRAP só usa a folga que não pertence a DAILY e LIVE', () => {
    const d = decide(policy, { used: emptyUsage() }, 'BOOTSTRAP');
    expect(d.allow).toBe(true);
    expect(d.borrowed).toBe(true);
    const full = decide(policy, { used: { ...emptyUsage(), BOOTSTRAP: 5 } }, 'BOOTSTRAP');
    expect(full.allow).toBe(false);
  });

  it('usa o contador do fornecedor como piso', () => {
    const d = decide(policy, { used: emptyUsage(), providerUsed: 85 }, 'DAILY');
    expect(d.allow).toBe(false);
  });
});

/** Simula um dia inteiro alternando bootstrap guloso, sync diário e polling ao vivo. */
async function simulateDay(planned?: Partial<Record<Priority, number>>) {
  const gov = new InMemoryQuotaGovernor(
    () => policy,
    () => new Date('2026-10-21T12:00:00Z'),
  );
  if (planned) await gov.plan('football', '2026-10-21', planned);
  const sent: Record<Priority, number> = emptyUsage();
  const tryCall = async (priority: Priority) => {
    try {
      const t = await gov.acquire({ api: 'football', priority, endpoint: '/x', requestHash: 'h' });
      await gov.settle(t, 'ok');
      sent[priority] += 1;
      return true;
    } catch (err) {
      if (err instanceof QuotaExceededError) return false;
      throw err;
    }
  };
  // Madrugada: bootstrap tenta consumir tudo; depois sync diário (45) e ao vivo (50 ticks).
  for (let i = 0; i < 200; i++) await tryCall('BOOTSTRAP');
  for (let i = 0; i < 45; i++) await tryCall('DAILY');
  for (let i = 0; i < 50; i++) await tryCall('LIVE');
  return { sent, report: await gov.usage('football', '2026-10-21') };
}

describe('simulação de um dia (free, 100/dia)', () => {
  it('dia com jogos: bootstrap não rouba o sync diário nem o ao vivo; total ≤ 100', async () => {
    const { sent, report } = await simulateDay();
    expect(report.totalUsed).toBeLessThanOrEqual(100);
    expect(sent.BOOTSTRAP).toBe(5); // só a fatia não protegida (ADHOC)
    expect(sent.DAILY).toBe(40);
    expect(sent.LIVE).toBe(40);
    expect(report.totalUsed).toBe(85); // reserva de 15 intacta
  });

  it('dia sem jogos planejado (LIVE = 0): bootstrap aproveita a folga', async () => {
    const { sent, report } = await simulateDay({ LIVE: 0, DAILY: 20 });
    expect(sent.BOOTSTRAP).toBe(65);
    expect(sent.DAILY).toBe(20);
    expect(sent.LIVE).toBe(0);
    expect(report.totalUsed).toBe(85);
  });
});

describe('InMemoryQuotaGovernor.reconcile', () => {
  it('soma ao contador do fornecedor as chamadas feitas depois da leitura', async () => {
    const gov = new InMemoryQuotaGovernor(
      () => policy,
      () => new Date('2026-10-21T12:00:00Z'),
    );
    await gov.reconcile('mma', 84, 100);
    await gov.acquire({ api: 'mma', priority: 'DAILY', endpoint: '/fights', requestHash: 'a' });
    await expect(
      gov.acquire({ api: 'mma', priority: 'DAILY', endpoint: '/fights', requestHash: 'b' }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

describe('limite do fornecedor', () => {
  it('limite informado pelo fornecedor menor que o configurado prevalece (Pro expirou → free)', () => {
    const pro = defaultPolicy(7500, 15);
    const used = { ...emptyUsage(), DAILY: 45 }; // 40 da fatia + 5 de folga no free
    expect(decide(pro, { used }, 'DAILY').allow).toBe(true);
    expect(decide(pro, { used, providerLimit: 100 }, 'DAILY').allow).toBe(false);
  });
});

describe('reconcile com leitura atrasada', () => {
  it('não esquece as chamadas feitas desde a leitura anterior', async () => {
    const gov = new InMemoryQuotaGovernor(
      () => policy,
      () => new Date('2026-10-21T12:00:00Z'),
    );
    await gov.reconcile('nba', 10, 100);
    for (let i = 0; i < 5; i++) {
      await gov.acquire({ api: 'nba', priority: 'DAILY', endpoint: '/games', requestHash: `h${i}` });
    }
    expect((await gov.usage('nba')).providerUsed).toBe(15);
    await gov.reconcile('nba', 10, 100); // fornecedor ainda não contou as 5
    expect((await gov.usage('nba')).providerUsed).toBe(15);
  });

  it('pedido idêntico pendente bloqueia uma segunda reserva', async () => {
    const gov = new InMemoryQuotaGovernor(
      () => policy,
      () => new Date('2026-10-21T12:00:00Z'),
    );
    const t = await gov.acquire({ api: 'afl', priority: 'DAILY', endpoint: '/games', requestHash: 'same' });
    await expect(
      gov.acquire({ api: 'afl', priority: 'DAILY', endpoint: '/games', requestHash: 'same' }),
    ).rejects.toThrow(/andamento/);
    await gov.settle(t, 'ok');
    await expect(
      gov.acquire({ api: 'afl', priority: 'DAILY', endpoint: '/games', requestHash: 'same' }),
    ).resolves.toBeDefined();
  });
});
