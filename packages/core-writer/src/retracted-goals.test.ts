import { describe, expect, it } from 'vitest';
import {
  advanceGoalWatch,
  isRetractedGoalRow,
  RETRACTED_GOAL_DETAIL,
  RETRACTED_GOAL_MARK,
  RETRACTED_GOAL_SEQUENCE_BASE,
  type GoalWatch,
  type IncidentRow,
} from './retracted-goals.js';

const SAO = 'sao-paulo';
const COR = 'corinthians';
const SIDES = new Map([
  [SAO, 'home'],
  [COR, 'away'],
] as const);
const KICK = Date.parse('2026-11-05T01:00:00Z');

type GoalSpec = { min: number; team?: string; by?: string | null; type?: string; extra?: number };

const goal = (
  { min, team = COR, by = 'bidu', type = 'goal', extra }: GoalSpec,
  sequence = 0,
): IncidentRow => ({
  sequence,
  minute: min,
  extra: extra ?? null,
  type,
  detail: type === 'own_goal' ? 'Own Goal' : 'Normal Goal',
  participantId: team,
  personId: by,
  assistPersonId: null,
  data: { type: 'Goal', comments: null, player: { id: 1, name: by } },
});

const card = (sequence: number, min = 10): IncidentRow => ({
  sequence,
  minute: min,
  extra: null,
  type: 'card',
  detail: 'Yellow Card',
  participantId: SAO,
  personId: 'newton',
  assistPersonId: null,
  data: null,
});

const providerVar = (sequence: number, min: number, team = COR): IncidentRow => ({
  sequence,
  minute: min,
  extra: null,
  type: 'var',
  detail: 'Goal cancelled',
  participantId: team,
  personId: 'bidu',
  assistPersonId: null,
  data: null,
});

interface Poll {
  /** Segundos desde o começo do cenário. */
  at: number;
  score?: [number, number] | null;
  /** Timeline da resposta; omitida = resposta sem `events`. */
  list?: IncidentRow[];
  code?: string;
  minute?: number;
  finished?: boolean;
}

/** Reproduz o que o upsert faz a cada resposta: guarda a memória e a timeline gravada. */
function game(initial: { stored?: IncidentRow[]; watch?: GoalWatch | null; prior?: [number, number] } = {}) {
  let watch = initial.watch ?? null;
  let stored = initial.stored ?? [];
  let prior = initial.prior ?? null;
  const self = {
    get watch() {
      return watch;
    },
    get stored() {
      return stored;
    },
    get inferred() {
      return stored.filter(isRetractedGoalRow);
    },
    poll(p: Poll) {
      const score = p.score === null ? null : (p.score ?? prior);
      const result = advanceGoalWatch({
        watch,
        previous: stored,
        next: p.list ?? null,
        score: score ? { home: score[0], away: score[1] } : null,
        priorScore: prior ? { home: prior[0], away: prior[1] } : null,
        sides: SIDES,
        clock: { code: p.code ?? '2H', minute: p.minute ?? 60 + Math.floor(p.at / 60) },
        finished: p.finished ?? false,
        observedAt: new Date(KICK + p.at * 1000),
      });
      watch = result.watch;
      const provider = result.replaceTimeline ? p.list! : stored.filter((i) => !isRetractedGoalRow(i));
      stored = [...provider, ...result.retracted];
      if (score) prior = score;
      return result;
    },
  };
  return self;
}

describe('advanceGoalWatch: classes medidas no raw', () => {
  it('A: timeline e placar caem juntos; vira lance só depois de 45 s fora, nada antes', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 62 }), card(1)] });
    const out = g.poll({ at: 15, score: [0, 0], list: [card(0)] });
    expect(out.retracted).toEqual([]);
    expect(g.watch?.pending).toHaveLength(1);
    expect(g.poll({ at: 45, score: [0, 0], list: [card(0)] }).retracted).toEqual([]);
    const done = g.poll({ at: 60, score: [0, 0], list: [card(0)] });
    expect(done.retracted).toHaveLength(1);
    expect(done.retracted[0]).toMatchObject({
      sequence: RETRACTED_GOAL_SEQUENCE_BASE,
      type: 'var',
      detail: RETRACTED_GOAL_DETAIL,
      minute: 62,
      participantId: COR,
      personId: 'bidu',
      assistPersonId: null,
    });
    expect(done.retracted[0]!.data).toMatchObject({
      type: 'Var',
      detail: RETRACTED_GOAL_DETAIL,
      player: { name: 'bidu' },
      galaxie: { inferred: RETRACTED_GOAL_MARK, goal: { type: 'goal', detail: 'Normal Goal' } },
    });
    expect(g.watch).toMatchObject({ pending: [], peak: { home: 0, away: 0 } });
    // não duplica nas trocas seguintes
    expect(g.poll({ at: 75, score: [0, 0], list: [card(0), card(1, 70)] }).retracted).toEqual(done.retracted);
  });

  it('B: timeline cai e o placar nunca cai; expira em 90 s sem rastro', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 62 })] });
    g.poll({ at: 15, score: [0, 1], list: [card(0)] });
    expect(g.watch?.pending).toHaveLength(1);
    g.poll({ at: 90, score: [0, 1], list: [card(0)] });
    expect(g.watch?.pending).toHaveLength(1);
    const out = g.poll({ at: 105, score: [0, 1], list: [card(0)] });
    expect(out.retracted).toEqual([]);
    expect(g.watch?.pending).toEqual([]);
    expect(g.stored.map((i) => i.type)).toEqual(['card']);
  });

  it('B: gol que entrou na timeline antes do placar e saiu sem o placar subir não deixa crédito', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 0], list: [card(0)] });
    g.poll({ at: 15, score: [0, 0], list: [card(0), goal({ min: 62 }, 1)] });
    g.poll({ at: 30, score: [0, 0], list: [card(0)] });
    g.poll({ at: 90, score: [0, 0], list: [card(0)] });
    const out = g.poll({ at: 150, score: [0, 0], list: [card(0)] });
    expect(out.retracted).toEqual([]);
  });

  it('C: a timeline cai primeiro e o placar só 60 s depois (a espera cobre a queda)', () => {
    const g = game();
    g.poll({ at: 0, score: [1, 1], list: [goal({ min: 45 })] });
    g.poll({ at: 15, score: [1, 1], list: [card(0)] });
    expect(g.poll({ at: 60, score: [1, 1], list: [card(0)] }).retracted).toEqual([]);
    const out = g.poll({ at: 75, score: [1, 0], list: [card(0)] });
    expect(out.confirmed).toHaveLength(1);
    expect(out.retracted[0]).toMatchObject({ minute: 45, participantId: COR });
  });

  it('D: o placar cai antes (até 54 min) e o gol segue na timeline; o crédito espera ele sair', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 19 })] });
    g.poll({ at: 15, score: [0, 0], list: [goal({ min: 19 })] });
    g.poll({ at: 54 * 60, score: [0, 0], list: [goal({ min: 19 })] });
    expect(g.watch?.peak).toMatchObject({ away: 1 });
    expect(g.inferred).toEqual([]);
    g.poll({ at: 54 * 60 + 15, score: [0, 0], list: [card(0)] });
    expect(g.inferred).toEqual([]);
    const out = g.poll({ at: 54 * 60 + 60, score: [0, 0], list: [card(0)] });
    expect(out.retracted).toHaveLength(1);
  });

  it('D: gol que sai no mesmo poll em que entra outro do adversário ainda é anulação', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 14 })] });
    g.poll({ at: 15, score: [0, 0], list: [goal({ min: 14 })] });
    g.poll({ at: 300, score: [1, 0], list: [goal({ min: 29, team: SAO, by: 'calleri' })] });
    expect(g.watch?.pending).toHaveLength(1);
    const out = g.poll({ at: 360, score: [1, 0], list: [goal({ min: 29, team: SAO, by: 'calleri' })] });
    expect(out.retracted).toHaveLength(1);
    expect(out.retracted[0]).toMatchObject({ minute: 14, participantId: COR });
  });

  it('E: lista vazia com placar inalterado não é retirada e a timeline fica', () => {
    const list = [
      goal({ min: 5 }, 0),
      goal({ min: 10 }, 1),
      goal({ min: 15 }, 2),
      goal({ min: 40, team: SAO, by: 'calleri' }, 3),
      goal({ min: 67 }, 4),
      card(5),
    ];
    const g = game();
    g.poll({ at: 0, score: [1, 4], list });
    const wiped = g.poll({ at: 15, score: [1, 4], list: [] });
    expect(wiped.replaceTimeline).toBe(false);
    expect(g.stored).toEqual(list);
    expect(g.watch?.pending).toEqual([]);
    g.poll({ at: 90, score: [1, 4], list: [] });
    expect(g.stored).toEqual(list);
    const back = g.poll({ at: 105, score: [1, 4], list });
    expect(back.replaceTimeline).toBe(true);
    expect(back.retracted).toEqual([]);
  });

  it('E: lista vazia com placar caindo a zero é retirada legítima (1-0 sem outros lances)', () => {
    const g = game();
    g.poll({ at: 0, score: [1, 0], list: [goal({ min: 30, team: SAO, by: 'calleri' })] });
    const out = g.poll({ at: 15, score: [0, 0], list: [] });
    expect(out.replaceTimeline).toBe(true);
    expect(g.stored).toEqual([]);
    g.poll({ at: 30, score: [0, 0], list: [] });
    const done = g.poll({ at: 60, score: [0, 0], list: [] });
    expect(done.retracted).toHaveLength(1);
    expect(done.retracted[0]).toMatchObject({ minute: 30, participantId: SAO });
  });

  it('E: lista vazia junto da queda de um lado não perde a retirada: vem na lista seguinte', () => {
    const a = goal({ min: 20 }, 0);
    const b = goal({ min: 30, team: SAO, by: 'calleri' }, 1);
    const g = game();
    g.poll({ at: 0, score: [1, 1], list: [a, b] });
    expect(g.poll({ at: 15, score: [0, 1], list: [] }).replaceTimeline).toBe(false);
    g.poll({ at: 45, score: [0, 1], list: [a] });
    const out = g.poll({ at: 90, score: [0, 1], list: [a] });
    expect(out.retracted).toHaveLength(1);
    expect(out.retracted[0]).toMatchObject({ minute: 30, participantId: SAO });
  });

  it('E: lista vazia sem placar conhecido também não apaga', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 20 })] });
    expect(g.poll({ at: 15, score: null, list: [] }).replaceTimeline).toBe(false);
  });

  it('F: gol que volta antes dos 45 s cancela o pendente, mesmo com autor preenchido e minuto mudado', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 62, by: null })] });
    g.poll({ at: 15, score: [0, 1], list: [card(0)] });
    expect(g.watch?.pending).toHaveLength(1);
    g.poll({ at: 30, score: [0, 1], list: [goal({ min: 63, by: 'yuri' })] });
    expect(g.watch?.pending).toEqual([]);
    expect(g.poll({ at: 120, score: [0, 1], list: [goal({ min: 63, by: 'yuri' })] }).retracted).toEqual([]);
  });

  it('F: gol que volta com autor trocado depois de confirmado desfaz o lance', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 62 })] });
    g.poll({ at: 15, score: [0, 0], list: [card(0)] });
    expect(g.poll({ at: 75, score: [0, 0], list: [card(0)] }).retracted).toHaveLength(1);
    const out = g.poll({ at: 300, score: [0, 1], list: [card(0), goal({ min: 64, by: 'garro' }, 1)] });
    expect(out.retracted).toEqual([]);
    expect(g.watch?.peak).toMatchObject({ away: 1 });
  });

  it('F: resposta atrasada com o relógio recuado não muda nada, nem a timeline', () => {
    const g = game();
    const withGoal = [goal({ min: 62 }), card(1)];
    g.poll({ at: 0, score: [0, 1], minute: 64, list: withGoal });
    const before = g.watch;
    const stale = g.poll({ at: 15, score: [0, 0], minute: 63, list: [card(0)] });
    expect(stale).toMatchObject({ replaceTimeline: false, confirmed: [] });
    expect(g.watch).toBe(before);
    expect(g.stored).toEqual(withGoal);
    // nem a recíproca: gol de volta em resposta velha não cancela o que já saiu
    g.poll({ at: 30, score: [0, 0], minute: 64, list: [card(0)] });
    g.poll({ at: 40, score: [0, 1], minute: 63, list: withGoal });
    expect(g.watch?.pending).toHaveLength(1);
  });

  it('F: fase anterior também é resposta velha, e a passagem pela prorrogação não é', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], code: 'HT', minute: 45, list: [goal({ min: 20 })] });
    expect(g.poll({ at: 15, score: [0, 1], code: '1H', minute: 45, list: [] }).replaceTimeline).toBe(false);
    for (const [at, code, minute] of [
      [60, '2H', 46],
      [90, 'BT', 90],
      [120, 'ET', 91],
      [150, 'BT', 105],
      [180, 'ET', 106],
      [210, 'P', 120],
      [240, 'PEN', 120],
    ] as const) {
      const list = [goal({ min: 20 }), card(1, minute)];
      expect(g.poll({ at, score: [0, 1], code, minute, list }).replaceTimeline).toBe(true);
    }
  });

  it('recuo grande é relógio errado, não resposta velha: não segura a lista com o gol novo', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], code: '2H', minute: 66, list: [goal({ min: 20 })] });
    const list = [goal({ min: 20 }), goal({ min: 67, by: 'yuri' }, 1)];
    expect(g.poll({ at: 15, score: [0, 2], code: '1H', minute: 17, list }).replaceTimeline).toBe(true);
    expect(g.stored).toEqual(list);
    // e um relógio errado para cima não trava as respostas certas que vêm depois
    g.poll({ at: 30, score: [0, 2], code: 'ET', minute: 144, list });
    expect(g.poll({ at: 45, score: [0, 2], code: 'ET', minute: 97, list }).replaceTimeline).toBe(true);
  });

  it('relógio recuado há mais de 10 min é correção da fonte e passa a valer', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], code: 'FT', minute: 90, list: [goal({ min: 20 })] });
    const back = () => g.poll({ at: 601, score: [0, 1], code: '2H', minute: 88, list: [goal({ min: 20 })] });
    expect(g.poll({ at: 599, score: [0, 1], code: '2H', minute: 88, list: [card(0)] }).replaceTimeline).toBe(
      false,
    );
    expect(back().replaceTimeline).toBe(true);
    expect(g.watch?.clock).toMatchObject({ rank: 3, minute: 88 });
  });
});

describe('advanceGoalWatch: um para um (P2 do Codex no PR 643)', () => {
  const twoInferred = () => {
    const g = game();
    const a = goal({ min: 60 }, 0);
    const b = goal({ min: 61 }, 1);
    g.poll({ at: 0, score: [0, 2], list: [a, b] });
    g.poll({ at: 15, score: [0, 0], list: [card(0)] });
    expect(g.poll({ at: 75, score: [0, 0], list: [card(0)] }).retracted).toHaveLength(2);
    return g;
  };

  it('dois inferidos do mesmo jogador aos 60 e 61, só o de 60 volta: o de 61 fica', () => {
    const g = twoInferred();
    const out = g.poll({ at: 300, score: [0, 1], list: [card(0), goal({ min: 60 }, 1)] });
    expect(out.retracted.map((i) => i.minute)).toEqual([61]);
    const again = g.poll({ at: 315, score: [0, 1], list: [card(0), goal({ min: 60 }, 1)] });
    expect(again.retracted.map((i) => i.minute)).toEqual([61]);
  });

  it('um único VAR do fornecedor retira um inferido, o mais perto, e para sempre só aquele', () => {
    const g = twoInferred();
    const list = [card(0), providerVar(1, 61)];
    const out = g.poll({ at: 300, score: [0, 0], list });
    expect(out.retracted.map((i) => i.minute)).toEqual([60]);
    expect(g.watch?.usedVars).toEqual([{ participantId: COR, minute: 61 }]);
    expect(g.poll({ at: 315, score: [0, 0], list }).retracted.map((i) => i.minute)).toEqual([60]);
    // o segundo VAR leva o outro
    const both = [card(0), providerVar(1, 61), providerVar(2, 60)];
    expect(g.poll({ at: 330, score: [0, 0], list: both }).retracted).toEqual([]);
  });

  it('VAR do fornecedor dispensa o gol ainda pendente, e não o que veio de outro time', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 62 })] });
    g.poll({ at: 15, score: [0, 0], list: [providerVar(0, 62, SAO)] });
    expect(g.watch?.pending).toHaveLength(1);
    g.poll({ at: 30, score: [0, 0], list: [providerVar(0, 62, SAO), providerVar(1, 63)] });
    expect(g.watch?.pending).toEqual([]);
    expect(g.watch?.peak).toMatchObject({ away: 0 });
    expect(g.poll({ at: 120, score: [0, 0], list: [providerVar(0, 62, SAO)] }).retracted).toEqual([]);
  });

  it('VAR do fornecedor que chega antes de o gol sair também dispensa', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 62 })] });
    g.poll({ at: 15, score: [0, 0], list: [goal({ min: 62 }, 0), providerVar(1, 62)] });
    g.poll({ at: 30, score: [0, 0], list: [providerVar(0, 62)] });
    expect(g.poll({ at: 120, score: [0, 0], list: [providerVar(0, 62)] }).retracted).toEqual([]);
  });

  it('gol reescrito na mesma resposta (autor, minuto, gol contra) não é retirada', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 62, by: null })] });
    g.poll({ at: 15, score: [0, 1], list: [goal({ min: 63, by: 'bidu' })] });
    expect(g.watch?.pending).toEqual([]);
    g.poll({ at: 30, score: [0, 1], list: [goal({ min: 63, by: 'bidu', type: 'own_goal' })] });
    expect(g.watch?.pending).toEqual([]);
    g.poll({ at: 45, score: [0, 1], list: [goal({ min: 63, by: 'bidu', team: SAO, type: 'goal' })] });
    expect(g.watch?.pending).toEqual([]);
  });

  it('dois gols retirados de um lado com só um a menos no placar: um lance só', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 2], list: [goal({ min: 60 }), goal({ min: 80, by: 'yuri' }, 1)] });
    g.poll({ at: 15, score: [0, 1], list: [card(0)] });
    const out = g.poll({ at: 75, score: [0, 1], list: [card(0)] });
    expect(out.retracted).toHaveLength(1);
    expect(g.poll({ at: 120, score: [0, 1], list: [card(0)] }).retracted).toHaveLength(1);
    expect(g.watch).toMatchObject({ pending: [], peak: { away: 1 } });
  });
});

describe('advanceGoalWatch: o crédito do placar', () => {
  it('placar que cai sem gol na timeline não deixa crédito para um falso depois', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 0], list: [card(0)] });
    g.poll({ at: 15, score: [0, 1], list: [card(0)] });
    expect(g.watch?.peak).toMatchObject({ away: 1 });
    g.poll({ at: 30, score: [0, 0], list: [card(0)] });
    expect(g.watch?.peak).toMatchObject({ away: 0 });
    // gol novo, placar já de volta, e a fonte oscila: sem crédito não vira lance
    g.poll({ at: 300, score: [0, 0], list: [card(0), goal({ min: 70 }, 1)] });
    g.poll({ at: 315, score: [0, 0], list: [card(0)] });
    expect(g.poll({ at: 390, score: [0, 0], list: [card(0)] }).retracted).toEqual([]);
  });

  it('placar que oscila e volta não gera lance', () => {
    const g = game();
    const list = [goal({ min: 62 })];
    g.poll({ at: 0, score: [0, 1], list });
    g.poll({ at: 15, score: [0, 0], list });
    g.poll({ at: 30, score: [0, 1], list });
    g.poll({ at: 300, score: [0, 1], list: [card(0)] });
    expect(g.poll({ at: 400, score: [0, 1], list: [card(0)] }).retracted).toEqual([]);
  });

  it('gol contra com o time beneficiado: olha o placar desse lado', () => {
    const g = game();
    const own = goal({ min: 40, team: COR, by: 'arboleda', type: 'own_goal' });
    g.poll({ at: 0, score: [0, 1], list: [own] });
    g.poll({ at: 15, score: [0, 0], list: [card(0)] });
    const out = g.poll({ at: 75, score: [0, 0], list: [card(0)] });
    expect(out.retracted).toHaveLength(1);
    expect(out.retracted[0]!.data).toMatchObject({ galaxie: { goal: { type: 'own_goal' } } });
    expect(g.watch?.peak).toEqual({ home: 0, away: 0 });
  });

  it('gol contra com o time do jogador: é o placar do outro lado que cai', () => {
    const g = game();
    const own = goal({ min: 40, team: SAO, by: 'arboleda', type: 'own_goal' });
    g.poll({ at: 0, score: [0, 1], list: [own] });
    g.poll({ at: 15, score: [0, 0], list: [card(0)] });
    expect(g.watch?.peak).toMatchObject({ away: 1 });
    const out = g.poll({ at: 75, score: [0, 0], list: [card(0)] });
    expect(out.retracted).toHaveLength(1);
    expect(g.watch?.peak).toEqual({ home: 0, away: 0 });
  });

  it('gol contra que sai sem o placar de nenhum lado cair: expira', () => {
    const g = game();
    g.poll({ at: 0, score: [1, 1], list: [goal({ min: 40, type: 'own_goal' })] });
    g.poll({ at: 15, score: [1, 1], list: [card(0)] });
    expect(g.poll({ at: 120, score: [1, 1], list: [card(0)] }).retracted).toEqual([]);
    expect(g.watch?.pending).toEqual([]);
  });

  it('cobrança da disputa de pênaltis não conta', () => {
    const kick = {
      ...goal({ min: 120 }),
      data: { comments: 'Penalty Shootout' },
    };
    const g = game();
    g.poll({ at: 0, score: [1, 1], code: 'P', minute: 120, list: [kick] });
    g.poll({ at: 15, score: [1, 1], code: 'P', minute: 120, list: [card(0)] });
    expect(g.watch?.pending).toEqual([]);
  });
});

describe('advanceGoalWatch: sem resposta com `events` e fim de jogo', () => {
  it('resposta sem `events` confirma o pendente e mantém a timeline', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], list: [goal({ min: 62 }), card(1)] });
    g.poll({ at: 15, score: [0, 1], list: [card(0)] });
    const out = g.poll({ at: 70, score: [0, 0] });
    expect(out.replaceTimeline).toBe(false);
    expect(out.confirmed).toHaveLength(1);
    expect(g.stored.map((i) => i.type)).toEqual(['card', 'var']);
  });

  it('resposta final: confirma na hora se o placar caiu, sem esperar os 45 s', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], minute: 90, list: [goal({ min: 88 })] });
    const out = g.poll({ at: 15, score: [0, 0], code: 'FT', minute: 90, finished: true, list: [card(0)] });
    expect(out.retracted).toHaveLength(1);
  });

  it('resposta final sem queda do placar não inventa lance', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], minute: 90, list: [goal({ min: 88 })] });
    const out = g.poll({ at: 15, score: [0, 1], code: 'FT', minute: 90, finished: true, list: [card(0)] });
    expect(out.retracted).toEqual([]);
  });

  it('jogo encerrado sem memória: a correção posterior da fonte ainda vira lance, pelo placar gravado', () => {
    const g = game({ stored: [goal({ min: 30 })], prior: [0, 1] });
    const out = g.poll({ at: 0, score: [0, 0], code: 'FT', minute: 90, finished: true, list: [card(0)] });
    expect(out.retracted).toHaveLength(1);
    expect(g.watch).toBeNull();
  });

  it('não grava memória à toa: 0 x 0 ao vivo, carga de jogo encerrado, jogo sem placar', () => {
    const zero = game();
    zero.poll({ at: 0, score: [0, 0], list: [card(0)] });
    expect(zero.watch).toBeNull();
    const done = game();
    done.poll({ at: 0, score: [2, 1], code: 'FT', minute: 90, finished: true, list: [goal({ min: 30 })] });
    expect(done.watch).toBeNull();
    const pre = game();
    expect(pre.poll({ at: 0, score: null, code: 'NS' }).watch).toBeNull();
  });

  it('memória sem pendente não muda entre respostas com o mesmo relógio', () => {
    const g = game();
    g.poll({ at: 0, score: [0, 1], minute: 60, list: [goal({ min: 20 })] });
    const first = g.watch;
    g.poll({ at: 15, score: [0, 1], minute: 60, list: [goal({ min: 20 })] });
    expect(g.watch).toEqual(first);
  });
});

describe('advanceGoalWatch: lance inferido no formato do PR 643', () => {
  const legacy = (minute: number, sequence = RETRACTED_GOAL_SEQUENCE_BASE): IncidentRow => ({
    sequence,
    minute,
    extra: null,
    type: 'var',
    detail: RETRACTED_GOAL_DETAIL,
    participantId: COR,
    personId: 'bidu',
    assistPersonId: null,
    data: {
      type: 'Var',
      detail: RETRACTED_GOAL_DETAIL,
      comments: null,
      assist: null,
      galaxie: { inferred: RETRACTED_GOAL_MARK, goal: { type: 'goal', detail: 'Normal Goal' } },
    },
  });

  it('sem memória, continua valendo e mantém a sequence nas trocas seguintes', () => {
    const g = game({ stored: [card(0), legacy(62)], prior: [0, 0] });
    const out = g.poll({ at: 0, score: [0, 0], list: [card(0), card(1, 70)] });
    expect(out.retracted).toEqual([legacy(62)]);
    expect(out.confirmed).toEqual([]);
  });

  it('sai com o gol de volta ou com o VAR do fornecedor', () => {
    const back = game({ stored: [card(0), legacy(62)], prior: [0, 0] });
    expect(back.poll({ at: 0, score: [0, 1], list: [goal({ min: 62 })] }).retracted).toEqual([]);
    const byVar = game({ stored: [card(0), legacy(62)], prior: [0, 0] });
    expect(byVar.poll({ at: 0, score: [0, 0], list: [providerVar(0, 63)] }).retracted).toEqual([]);
  });

  it('o lance novo vem depois do maior já usado', () => {
    const g = game({
      stored: [goal({ min: 80, by: 'yuri' }), legacy(62, RETRACTED_GOAL_SEQUENCE_BASE + 3)],
      prior: [0, 1],
    });
    g.poll({ at: 0, score: [0, 0], list: [card(0)] });
    const out = g.poll({ at: 60, score: [0, 0], list: [card(0)] });
    expect(out.retracted.map((i) => i.sequence)).toEqual([
      RETRACTED_GOAL_SEQUENCE_BASE + 3,
      RETRACTED_GOAL_SEQUENCE_BASE + 4,
    ]);
  });
});
