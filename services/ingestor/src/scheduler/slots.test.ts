import { describe, expect, it } from 'vitest';
import { JobSlots } from './slots.js';

describe('JobSlots', () => {
  it('passa a vaga de quem termina para o primeiro da fila', async () => {
    const slots = new JobSlots(2);
    const a = await slots.acquire();
    const b = await slots.acquire();
    const order: string[] = [];
    const c = slots.acquire().then((r) => (order.push('c'), r));
    const d = slots.acquire().then((r) => (order.push('d'), r));
    expect(slots.queued).toBe(2);
    a!();
    a!(); // soltar duas vezes não abre vaga a mais
    const releaseC = await c;
    expect(order).toEqual(['c']);
    expect(slots.running).toBe(2);
    b!();
    await d;
    expect(order).toEqual(['c', 'd']);
    releaseC!();
    expect(slots.running).toBe(1);
  });

  it('fechada, a fila desiste e nada novo entra', async () => {
    const slots = new JobSlots(1);
    await slots.acquire();
    const waiting = slots.acquire();
    slots.close();
    await expect(waiting).resolves.toBeNull();
    await expect(slots.acquire()).resolves.toBeNull();
  });

  it('teto inválido é erro', () => {
    expect(() => new JobSlots(0)).toThrow();
  });
});
