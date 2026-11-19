import { describe, expect, it } from 'vitest';
import {
  BOT_BLOCK_MS,
  botLinks,
  CADENCE_SAMPLES,
  cadenceOf,
  machineCadence,
  MemoryBotGuard,
  SIGNAL_WINDOW_MS,
  type BotInput,
} from './bot.js';

/* Detecção de robô do chat (#1290): ritmo de máquina trava; Conta com vários Perfis e link repetido só sinalizam. */

const input = (over: Partial<BotInput> = {}): BotInput => ({
  tenantId: 't1',
  roomId: 'r1',
  profileId: 'p1',
  accountId: 'a1',
  links: [],
  verified: false,
  slowModeMs: 0,
  now: 0,
  ...over,
});

describe('ritmo de máquina', () => {
  it('intervalos iguais e curtos são máquina; humano varia', () => {
    const robot = Array.from({ length: CADENCE_SAMPLES }, (_, i) => i * 5_000);
    expect(machineCadence(robot)).toBe(true);
    const jitter = robot.map((t, i) => t + (i % 2 ? 150 : 0));
    expect(machineCadence(jitter)).toBe(true);
    const human = [0, 3_000, 11_000, 12_500, 20_000, 31_000, 33_000, 45_000];
    expect(machineCadence(human)).toBe(false);
    // poucas mensagens não bastam; ritmo lento demais (a cada minuto) também não
    expect(machineCadence(robot.slice(0, CADENCE_SAMPLES - 1))).toBe(false);
    expect(machineCadence(robot.map((t) => t * 12))).toBe(false);
  });
});

describe('MemoryBotGuard', () => {
  it('ritmo de máquina trava 30 min, em todas as salas, e marca o sinal', async () => {
    const g = new MemoryBotGuard();
    let last = { blockedMs: 0, blockedNow: false, signals: [] as string[] };
    for (let i = 0; i < CADENCE_SAMPLES; i++) last = await g.check(input({ now: i * 4_000 }));
    expect(last).toEqual({ blockedMs: BOT_BLOCK_MS, blockedNow: true, signals: ['bot_cadence'] });
    const after = await g.check(input({ roomId: 'r2', now: CADENCE_SAMPLES * 4_000 }));
    expect(after.blockedNow).toBe(false);
    expect(after.blockedMs).toBe(BOT_BLOCK_MS - 4_000);
    // passou o bloqueio: volta a enviar
    expect((await g.check(input({ now: (CADENCE_SAMPLES - 1) * 4_000 + BOT_BLOCK_MS + 1 }))).blockedMs).toBe(
      0,
    );
  });

  it('quem verificou a idade com documento não é travado: só sinaliza', async () => {
    const g = new MemoryBotGuard();
    let last = { blockedMs: 0, blockedNow: false, signals: [] as string[] };
    for (let i = 0; i < CADENCE_SAMPLES; i++) last = await g.check(input({ verified: true, now: i * 4_000 }));
    expect(last).toEqual({ blockedMs: 0, blockedNow: false, signals: ['bot_cadence'] });
  });

  it('vários Perfis da mesma Conta na mesma sala: sinaliza a partir do terceiro', async () => {
    const g = new MemoryBotGuard();
    expect((await g.check(input({ profileId: 'p1' }))).signals).toEqual([]);
    expect((await g.check(input({ profileId: 'p2', now: 1_000 }))).signals).toEqual([]);
    expect((await g.check(input({ profileId: 'p3', now: 2_000 }))).signals).toEqual(['bot_shared_account']);
    // outra sala e outra Conta não contam
    expect((await g.check(input({ profileId: 'p4', roomId: 'r2', now: 3_000 }))).signals).toEqual([]);
    // passou a janela: zera
    expect((await g.check(input({ profileId: 'p5', now: 2_000 + SIGNAL_WINDOW_MS + 1 }))).signals).toEqual(
      [],
    );
  });

  it('o mesmo link por Perfis diferentes de Contas diferentes: sinaliza a partir do terceiro', async () => {
    const g = new MemoryBotGuard();
    const at = (p: string, now: number) =>
      g.check(input({ profileId: p, accountId: `a-${p}`, links: ['promo.example.com/oferta'], now }));
    await at('p1', 0);
    await at('p2', 1_000);
    expect((await at('p3', 2_000)).signals).toEqual(['bot_shared_link']);
    // o mesmo Perfil repetindo o link não soma
    const g2 = new MemoryBotGuard();
    for (let i = 0; i < 4; i++)
      await g2.check(input({ links: ['promo.example.com/oferta'], now: i * 37_000 + (i % 2) * 9_000 }));
    expect(
      (await g2.check(input({ links: ['promo.example.com/oferta'], now: 200_000 }))).signals,
    ).not.toContain('bot_shared_link');
  });

  it('torcida cantando o mesmo grito não é sinal (texto igual não entra)', async () => {
    const g = new MemoryBotGuard();
    for (let i = 0; i < 10; i++)
      expect(
        (await g.check(input({ profileId: `p${i}`, accountId: `a${i}`, now: i * 300 }))).signals,
      ).toEqual([]);
  });
});

describe('caso claro: só o ritmo mecânico de verdade trava (#1290, revisão)', () => {
  const every = (gap: number, jitter = 0) =>
    Array.from({ length: CADENCE_SAMPLES }, (_, i) => i * gap + (i % 2 ? jitter : 0));

  it('ritmo regular no degrau do modo lento é gente reenviando: sinaliza, não trava', () => {
    expect(cadenceOf(every(10_400, 300), 10_000)).toEqual({ signal: true, clear: false });
    // o mesmo ritmo sem modo lento é robô
    expect(cadenceOf(every(10_400, 30), 0)).toEqual({ signal: true, clear: true });
  });

  it('rajada abaixo de 1 s fica com o anti-flood; desvio acima de 250 ms não trava', () => {
    expect(cadenceOf(every(50), 0)).toEqual({ signal: true, clear: false });
    expect(cadenceOf(every(15_000, 600), 0)).toEqual({ signal: true, clear: false });
  });

  it('o modo lento não deixa a pessoa travada no guarda', async () => {
    const g = new MemoryBotGuard();
    let last = { blockedMs: 0, blockedNow: false, signals: [] as string[] };
    for (const t of every(10_400, 300)) last = await g.check(input({ slowModeMs: 10_000, now: t }));
    expect(last).toEqual({ blockedMs: 0, blockedNow: false, signals: ['bot_cadence'] });
  });
});

describe('botLinks', () => {
  it('domínio e caminho, sem consulta, âncora nem barra final', () => {
    expect(botLinks('olha https://Promo.example.com/oferta/?x=1 já', ['promo.example.com'])).toEqual([
      'promo.example.com/oferta',
    ]);
    expect(botLinks('site.com', ['site.com'])).toEqual(['site.com']);
  });
});
