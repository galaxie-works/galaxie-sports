import { describe, expect, it } from 'vitest';

import { MemoryFloodGuard, floodFingerprint } from './flood.js';

const rule = { maxPerMinute: 10, blockSeconds: 180 };

describe('anti-flood por pessoa', () => {
  it('a 11ª mensagem em 60 s bloqueia por 3 min, e o bloqueio acaba', async () => {
    const g = new MemoryFloodGuard();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) expect(await g.hit('t', 'p', `msg ${i}`, rule, t0 + i * 1000)).toBe(0);
    expect(await g.hit('t', 'p', 'msg 10', rule, t0 + 10_000)).toBe(180_000);
    expect(await g.hit('t', 'p', 'outra', rule, t0 + 70_000)).toBe(120_000);
    expect(await g.hit('t', 'p', 'voltei', rule, t0 + 190_001)).toBe(0);
  });

  it('a janela anda: 10 por minuto, espaçadas, não bloqueiam', async () => {
    const g = new MemoryFloodGuard();
    for (let i = 0; i < 30; i++) expect(await g.hit('t', 'p', `msg ${i}`, rule, i * 6_100)).toBe(0);
  });

  it('a mesma mensagem 3 vezes bloqueia (caixa e espaços não contam)', async () => {
    const g = new MemoryFloodGuard();
    expect(await g.hit('t', 'p', 'COMPRE AQUI AGORA', rule, 0)).toBe(0);
    expect(await g.hit('t', 'p', 'compre   aqui agora', rule, 1000)).toBe(0);
    expect(await g.hit('t', 'p', ' Compre aqui agora ', rule, 2000)).toBe(180_000);
  });

  it('comemoração curta repetida não é robô', async () => {
    const g = new MemoryFloodGuard();
    for (let i = 0; i < 6; i++) expect(await g.hit('t', 'p', 'GOOOL', rule, i * 1000)).toBe(0);
  });

  it('a memória faz faxina de quem sumiu', async () => {
    const g = new MemoryFloodGuard();
    for (let i = 0; i < 10_050; i++) await g.hit('t', `p${i}`, 'oi', rule, 0);
    await g.hit('t', 'novo', 'oi', rule, 120_000);
    const size = (g as unknown as { sent: Map<string, unknown> }).sent.size;
    expect(size).toBeLessThan(100);
  });

  it('cada pessoa e cada cliente contam à parte', async () => {
    const g = new MemoryFloodGuard();
    for (let i = 0; i < 10; i++) await g.hit('t', 'p', `m${i}`, rule, i);
    expect(await g.hit('t', 'outro', 'oi', rule, 20)).toBe(0);
    expect(await g.hit('t2', 'p', 'oi', rule, 20)).toBe(0);
  });

  it('a impressão do texto ignora caixa e espaços', () => {
    expect(floodFingerprint('Gol  do Time')).toBe(floodFingerprint('gol do time'));
    expect(floodFingerprint('gol')).not.toBe(floodFingerprint('gol!'));
  });
});
