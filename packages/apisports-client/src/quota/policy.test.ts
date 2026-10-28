import { describe, expect, it } from 'vitest';
import { InMemoryQuotaGovernor } from './governor.js';
import { decide, defaultPolicy, emptyUsage, headerFloorApplies } from './policy.js';
import { QuotaExceededError } from '../errors.js';
import type { Priority } from '../types.js';

const policy = defaultPolicy(100, 15);

describe('decide', () => {
  it('permite dentro da fatia da prioridade', () => {
    const d = decide(policy, { used: emptyUsage() }, 'DAILY');
    expect(d).toMatchObject({ allow: true, borrowed: false });
  });

  it('na produção, abaixo da reserva só o ao vivo chama; ele vai até o limite do dia', () => {
    const used = { ...emptyUsage(), DAILY: 45, LIVE: 40 };
    expect(decide(policy, { used }, 'DAILY')).toMatchObject({ allow: false, cap: 85 });
    expect(decide(policy, { used }, 'DAILY').reason).toMatch(/reserva do ao vivo/);
    expect(decide(policy, { used }, 'LIVE')).toMatchObject({ allow: true, cap: 100 });
    expect(decide(policy, { used: { ...used, LIVE: 55 } }, 'LIVE').allow).toBe(false);
  });

  it('no dev, a reserva vale para todos, inclusive o ao vivo', () => {
    const dev = defaultPolicy(100, 70, undefined, false);
    const used = { ...emptyUsage(), DAILY: 10 };
    // a outra ponta (produção) já gastou 20 da conta: o dev para em 30
    expect(decide(dev, { used, providerUsed: 29 }, 'LIVE').allow).toBe(true);
    expect(decide(dev, { used, providerUsed: 30 }, 'LIVE')).toMatchObject({ allow: false, cap: 30 });
    expect(decide(dev, { used, providerUsed: 30 }, 'DAILY').reason).toMatch(/limite diário atingido/);
  });

  it('BOOTSTRAP só usa a folga que não pertence a DAILY e LIVE', () => {
    const d = decide(policy, { used: emptyUsage() }, 'BOOTSTRAP');
    expect(d.allow).toBe(true);
    expect(d.borrowed).toBe(true);
    // abaixo de 85: DAILY (40) e o que a reserva de 15 não cobre do ao vivo (25) ficam protegidos
    expect(decide(policy, { used: { ...emptyUsage(), BOOTSTRAP: 19 } }, 'BOOTSTRAP').allow).toBe(true);
    const full = decide(policy, { used: { ...emptyUsage(), BOOTSTRAP: 20 } }, 'BOOTSTRAP');
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
    // a reserva de 15 já cobre parte da fatia do ao vivo: abaixo de 85 só se protegem DAILY (40) e 25 de LIVE
    expect(sent.BOOTSTRAP).toBe(20);
    expect(sent.DAILY).toBe(40);
    expect(sent.LIVE).toBe(40);
    expect(report.totalUsed).toBe(100); // o ao vivo fechou o dia dentro da reserva
  });

  it('dia sem jogos planejado (LIVE = 0): bootstrap aproveita a folga', async () => {
    const { sent, report } = await simulateDay({ LIVE: 0, DAILY: 20 });
    expect(sent.BOOTSTRAP).toBe(65);
    expect(sent.DAILY).toBe(20);
    expect(sent.LIVE).toBe(15); // jogo fora do plano ainda tem a reserva
    expect(report.totalUsed).toBe(100);
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
    // 40 da fatia + 20 de folga no free (a reserva de 15 já cobre parte dos 40 do ao vivo)
    const used = { ...emptyUsage(), DAILY: 60 };
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

describe('header de cota como piso (conta compartilhada entre dev e produção)', () => {
  const at = (iso: string) => () => new Date(iso);

  it('limite − restante vira piso: a outra ponta gastou, os jobs comuns param e o ao vivo segue', async () => {
    const gov = new InMemoryQuotaGovernor(() => defaultPolicy(75_000, 25), at('2026-10-21T12:00:00Z'));
    const t = await gov.acquire({
      api: 'football',
      priority: 'DAILY',
      endpoint: '/fixtures',
      requestHash: 'a',
    });
    // headers reais do Ultra: a conta inteira já gastou 57.000 (quase tudo do dev)
    await gov.settle(t, 'ok', 18_000, 75_000);
    expect((await gov.usage('football')).providerUsed).toBe(57_000);
    await expect(
      gov.acquire({ api: 'football', priority: 'DAILY', endpoint: '/fixtures', requestHash: 'b' }),
    ).rejects.toThrow(/reserva do ao vivo/);
    await expect(
      gov.acquire({ api: 'football', priority: 'LIVE', endpoint: '/fixtures', requestHash: 'c' }),
    ).resolves.toBeDefined();
  });

  it('nunca baixa o piso: um header atrasado não esquece o que já se sabia', async () => {
    const gov = new InMemoryQuotaGovernor(() => defaultPolicy(100), at('2026-10-21T12:00:00Z'));
    await gov.reconcile('nba', 40, 100, 'Free');
    const t = await gov.acquire({ api: 'nba', priority: 'DAILY', endpoint: '/games', requestHash: 'a' });
    await gov.settle(t, 'ok', 90, 100); // eventualmente consistente: diz 10 usadas
    expect((await gov.usage('nba')).providerUsed).toBe(41);
  });

  it('ignora o header nos primeiros minutos do dia, no quota_exhausted e fora da faixa', async () => {
    expect(headerFloorApplies('2026-10-22', Date.parse('2026-10-22T00:04:59Z'))).toBe(false);
    expect(headerFloorApplies('2026-10-22', Date.parse('2026-10-22T00:05:00Z'))).toBe(true);
    expect(headerFloorApplies('2026-10-21', Date.parse('2026-10-22T00:10:00Z'))).toBe(false);
    const gov = new InMemoryQuotaGovernor(() => defaultPolicy(100), at('2026-10-21T12:00:00Z'));
    for (const [api, outcome, remaining] of [
      ['afl', 'quota_exhausted', 0],
      ['mma', 'ok', 150],
    ] as const) {
      const t = await gov.acquire({ api, priority: 'DAILY', endpoint: '/games', requestHash: api });
      await gov.settle(t, outcome, remaining, 100);
      expect((await gov.usage(api)).providerUsed).toBeUndefined();
    }
  });
});

describe('pausa depois de um limite por minuto', () => {
  it('todas as prioridades da API esperam 30 s; as outras APIs seguem', async () => {
    let t = Date.parse('2026-10-21T12:00:00Z');
    const waits: number[] = [];
    const gov = new InMemoryQuotaGovernor(
      () => defaultPolicy(100),
      () => new Date(t),
      async (ms) => {
        waits.push(ms);
        t += ms;
      },
    );
    const first = await gov.acquire({ api: 'afl', priority: 'DAILY', endpoint: '/games', requestHash: 'a' });
    await gov.settle(first, 'rate_limited', 99);
    t += 10_000;
    expect((await gov.usage('afl')).pausedUntil).toBe('2026-10-21T12:00:30.000Z');
    await gov.acquire({ api: 'afl', priority: 'LIVE', endpoint: '/games', requestHash: 'b' });
    expect(waits).toEqual([20_000]);
    await gov.acquire({ api: 'nba', priority: 'DAILY', endpoint: '/games', requestHash: 'c' });
    expect(waits).toEqual([20_000]);
    expect((await gov.usage('afl')).pausedUntil).toBeUndefined();
  });
});
