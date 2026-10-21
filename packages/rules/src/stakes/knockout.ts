import type { KnockoutStageRules } from '../config/types.js';
import { makeStake, type Stake } from './codes.js';

/** Quem passa ao fim do tempo normal desta partida (ou para onde vai a decisão). */
export type TieOutcome = 'home' | 'away' | 'extra_time' | 'penalties';

export interface KnockoutMatchInput {
  rules: KnockoutStageRules;
  /** 1 = ida, 2 = volta. Em jogo único (`rules.legs = 1`) é ignorado. */
  leg?: 1 | 2;
  /**
   * Placar da ida, com mandante/visitante **da ida** (na volta os mandos se invertem).
   * Obrigatório para o jogo de volta.
   */
  firstLeg?: { homeGoals: number; awayGoals: number };
}

export class KnockoutInputError extends Error {
  override readonly name = 'KnockoutInputError';
}

/** Maior diferença e maior placar do perdedor varridos ao derivar os códigos. */
const MAX_MARGIN = 10;
const MAX_GOALS = 8;

function isSecondLeg(input: KnockoutMatchInput): boolean {
  return input.rules.legs === 2 && input.leg === 2;
}

function checkGoals(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new KnockoutInputError(`${field} deve ser inteiro >= 0 (recebido ${String(value)}).`);
  }
}

function levelOutcome(rules: KnockoutStageRules): TieOutcome {
  return rules.extraTime ? 'extra_time' : 'penalties';
}

/**
 * Resultado do confronto se esta partida terminar `homeGoals × awayGoals` no tempo normal.
 * Serve também para o estado ao vivo ("quem está passando agora").
 */
export function tieOutcome(input: KnockoutMatchInput, homeGoals: number, awayGoals: number): TieOutcome {
  checkGoals(homeGoals, 'homeGoals');
  checkGoals(awayGoals, 'awayGoals');
  const { rules } = input;
  if (rules.legs === 1) {
    if (homeGoals !== awayGoals) return homeGoals > awayGoals ? 'home' : 'away';
    return rules.drawAdvantage ?? levelOutcome(rules);
  }
  if (input.leg !== 2) {
    throw new KnockoutInputError('O jogo de ida não decide o confronto; tieOutcome só vale para a volta.');
  }
  const first = input.firstLeg;
  if (!first) throw new KnockoutInputError('Jogo de volta exige o placar da ida (firstLeg).');
  checkGoals(first.homeGoals, 'firstLeg.homeGoals');
  checkGoals(first.awayGoals, 'firstLeg.awayGoals');
  // O mandante da volta foi o visitante da ida.
  const aggHome = first.awayGoals + homeGoals;
  const aggAway = first.homeGoals + awayGoals;
  if (aggHome !== aggAway) return aggHome > aggAway ? 'home' : 'away';
  if (rules.awayGoals && !rules.neutralVenue) {
    const homeAwayGoals = first.awayGoals;
    const awayAwayGoals = awayGoals;
    if (homeAwayGoals !== awayAwayGoals) return homeAwayGoals > awayAwayGoals ? 'home' : 'away';
  }
  return levelOutcome(rules);
}

type Category = 'advance' | 'eliminated' | 'extra_time' | 'penalties' | 'mixed';

function toCategory(outcome: TieOutcome, side: 'home' | 'away'): Exclude<Category, 'mixed'> {
  if (outcome === 'home' || outcome === 'away') return outcome === side ? 'advance' : 'eliminated';
  return outcome;
}

/** Categoria de uma margem (gols do time − gols do rival) varrendo todos os placares possíveis. */
function marginCategory(input: KnockoutMatchInput, side: 'home' | 'away', margin: number): Category {
  let cat: Category | null = null;
  for (let loser = 0; loser <= MAX_GOALS; loser++) {
    const mine = margin >= 0 ? loser + margin : loser;
    const theirs = margin >= 0 ? loser : loser - margin;
    const [h, a] = side === 'home' ? [mine, theirs] : [theirs, mine];
    const c = toCategory(tieOutcome(input, h, a), side);
    if (cat === null) cat = c;
    else if (cat !== c) return 'mixed';
  }
  return cat!;
}

/** Placares de empate g×g em que o time avança. */
function advancingDraws(input: KnockoutMatchInput, side: 'home' | 'away'): number[] {
  const out: number[] = [];
  for (let g = 0; g <= MAX_GOALS; g++) if (tieOutcome(input, g, g) === side) out.push(g);
  return out;
}

function decisiveStakes(input: KnockoutMatchInput): Stake[] {
  const stakes: Stake[] = [];
  const both: Stake[] = [];
  const pushBoth = (s: Stake) => {
    if (!both.some((b) => b.code === s.code)) both.push(s);
  };
  for (const side of ['home', 'away'] as const) {
    const cats = new Map<number, Category>();
    for (let m = -MAX_MARGIN; m <= MAX_MARGIN; m++) cats.set(m, marginCategory(input, side, m));
    // Menor margem a partir da qual o time sempre avança no tempo normal.
    let threshold: number | null = null;
    for (let m = MAX_MARGIN; m >= -MAX_MARGIN && cats.get(m) === 'advance'; m--) threshold = m;
    if (threshold === null) continue;
    const drawCat = cats.get(0)!;
    if (threshold <= -1) stakes.push(makeStake(side, 'advances_with_loss_by_n', { n: -threshold }));
    else if (threshold === 0) stakes.push(makeStake(side, 'advances_with_draw'));
    else if (threshold === 1 && drawCat === 'mixed') {
      // Gol fora: só alguns empates classificam.
      const draws = advancingDraws(input, side);
      if (draws.length > 0 && draws[0] === 0) {
        stakes.push(makeStake(side, 'advances_with_draw_up_to_n', { n: draws[draws.length - 1]! }));
      } else if (draws.length > 0) {
        stakes.push(makeStake(side, 'advances_with_draw_from_n', { n: draws[0]! }));
      } else {
        stakes.push(makeStake(side, 'needs_win'));
      }
    } else if (threshold === 1) stakes.push(makeStake(side, 'needs_win'));
    else stakes.push(makeStake(side, 'needs_win_by_n', { n: threshold }));

    const below = threshold - 1;
    const belowCat = cats.get(below);
    if (below >= 1) {
      if (belowCat === 'penalties') stakes.push(makeStake(side, 'win_by_n_goes_to_penalties', { n: below }));
      else if (belowCat === 'extra_time')
        stakes.push(makeStake(side, 'win_by_n_goes_to_extra_time', { n: below }));
      else if (belowCat === 'mixed')
        stakes.push(makeStake(side, 'outcome_depends_on_away_goals', { n: below }));
    } else if (below === 0) {
      if (belowCat === 'penalties') pushBoth(makeStake('both', 'draw_goes_to_penalties'));
      else if (belowCat === 'extra_time') pushBoth(makeStake('both', 'draw_goes_to_extra_time'));
    }
  }
  // Empates específicos que levam à prorrogação/pênaltis (só ocorrem com gol fora).
  const drawsVary = tieOutcome(input, 0, 0) !== tieOutcome(input, MAX_GOALS, MAX_GOALS);
  for (let g = 0; drawsVary && g <= MAX_GOALS; g++) {
    const o = tieOutcome(input, g, g);
    if (o === 'extra_time') pushBoth(makeStake('both', 'specific_draw_goes_to_extra_time', { n: g }));
    else if (o === 'penalties') pushBoth(makeStake('both', 'specific_draw_goes_to_penalties', { n: g }));
  }
  return [...stakes, ...both];
}

function infoStakes(input: KnockoutMatchInput): Stake[] {
  const { rules } = input;
  const out: Stake[] = [];
  if (rules.legs === 2 && rules.awayGoals && !rules.neutralVenue)
    out.push(makeStake('both', 'away_goals_rule'));
  const decisive = rules.legs === 1 || input.leg === 2;
  if (decisive && rules.extraTime && rules.penalties && !(rules.legs === 1 && rules.drawAdvantage)) {
    out.push(makeStake('both', 'extra_time_then_penalties'));
  }
  if (decisive && rules.decidesTitle) out.push(makeStake('both', 'decides_title'));
  return out;
}

/**
 * Stakes de uma partida de mata-mata: o que cada lado precisa para avançar.
 * Ordem: códigos por time (mandante, visitante), depois os do confronto (`both`).
 */
export function knockoutStakes(input: KnockoutMatchInput): Stake[] {
  const { rules } = input;
  if (rules.legs === 2 && input.leg !== 2) {
    if (input.leg !== 1) throw new KnockoutInputError('Confronto de ida e volta: informe leg = 1 ou 2.');
    return [makeStake('both', 'first_leg'), ...infoStakes(input)];
  }
  if (isSecondLeg(input) && !input.firstLeg) {
    throw new KnockoutInputError('Jogo de volta exige o placar da ida (firstLeg).');
  }
  return [...decisiveStakes(input), ...infoStakes(input)];
}
