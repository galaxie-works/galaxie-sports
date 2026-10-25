import { describe, expect, it } from 'vitest';
import { brasileiraoRules, currentTable, finishedInput, loadR32 } from '../test-helpers.js';
import { makeStake, type Stake } from './codes.js';
import { localizeStake } from './labels.js';
import { leagueMatchStakes, type LeagueTeamInput } from './league.js';
import { finishedLeagueMatchStakes, leagueInputOf } from './result.js';
import {
  isSalient,
  MAX_SALIENT_STAKES,
  SALIENCE_FRACTION,
  SALIENCE_MIN_GAP,
  salienceFight,
  salienceGap,
  salienceStanding,
  salienceWindow,
  salientStakes,
} from './salience.js';

const fx = loadR32();
const rules = brasileiraoRules();
const league = rules.league!;
const table = currentTable(fx);
const standingOf = (t: LeagueTeamInput[], id: string) =>
  salienceStanding(t, league, id, rules.standings.points)!;
const codes = (stakes: Stake[], side: 'home' | 'away') =>
  stakes.filter((s) => s.team === side).map((s) => s.code);

/** Stakes pré-jogo de um jogo da rodada 32 ainda por jogar, com a tabela atual da produção. */
function preMatch(homeId: string, awayId: string) {
  const all = leagueMatchStakes({
    table,
    league,
    points: rules.standings.points,
    homeId,
    awayId,
    nextRound: [
      { homeId: 'coritiba', awayId: 'gremio' },
      { homeId: 'flamengo', awayId: 'atletico-mg' },
    ],
  });
  const salient = salientStakes(all, { home: standingOf(table, homeId), away: standingOf(table, awayId) });
  return { all, salient };
}

describe('regra de corte', () => {
  it('janela = max(3, ⅓ dos pontos em disputa)', () => {
    expect(SALIENCE_FRACTION).toBeCloseTo(1 / 3);
    expect(SALIENCE_MIN_GAP).toBe(3);
    expect(MAX_SALIENT_STAKES).toBe(3);
    // Flamengo: 31 jogos, 7 restantes → 21 pontos em disputa → janela de 7
    expect(salienceWindow(standingOf(table, 'flamengo'))).toBe(7);
    // última rodada: 3 pontos em disputa, a janela não cai abaixo de uma vitória
    expect(salienceWindow({ ...standingOf(table, 'flamengo'), remaining: 1 })).toBe(3);
    expect(salienceWindow({ ...standingOf(table, 'flamengo'), remaining: null })).toBe(Infinity);
  });

  it('distância por briga, em pontos', () => {
    const fla = standingOf(table, 'flamengo');
    expect(salienceGap(makeStake('home', 'in_title_race'), fla)).toBe(2); // 69 − 67
    expect(salienceGap(makeStake('home', 'at_risk_of_relegation'), fla)).toBe(34); // 67 − 33 (17º)
    expect(salienceGap(makeStake('home', 'qualifies_for_zone', { zone: 'sudamericana' }), fla)).toBe(0);
    const cori = standingOf(table, 'coritiba');
    expect(salienceGap(makeStake('home', 'at_risk_of_relegation'), cori)).toBe(6); // 39 − 33
    expect(
      salienceGap(makeStake('home', 'can_qualify_for_zone', { zone: 'libertadores_group_stage' }), cori),
    ).toBe(15); // 54 (4º) − 39
    const gre = standingOf(table, 'gremio');
    expect(salienceGap(makeStake('away', 'at_risk_of_relegation'), gre)).toBe(0); // já na zona
    expect(salienceGap(makeStake('home', 'moved_up_to_n', { n: 3 }), gre)).toBeNull();
    expect(salienceGap(makeStake('home', 'needs_win'), gre)).toBeNull();
  });

  it('corta o improvável e mantém o próximo', () => {
    const fla = standingOf(table, 'flamengo');
    expect(isSalient(makeStake('home', 'at_risk_of_relegation'), fla)).toBe(false);
    expect(isSalient(makeStake('home', 'in_title_race'), fla)).toBe(true);
    const cori = standingOf(table, 'coritiba');
    expect(isSalient(makeStake('home', 'at_risk_of_relegation'), cori)).toBe(true);
    expect(
      isSalient(makeStake('home', 'can_qualify_for_zone', { zone: 'libertadores_group_stage' }), cori),
    ).toBe(false);
    // sem tabela, nada é cortado
    expect(isSalient(makeStake('home', 'at_risk_of_relegation'), null)).toBe(true);
  });

  it('classifica as brigas', () => {
    expect(salienceFight(makeStake('home', 'seeks_title_n', { n: 4 }))).toBe('title');
    expect(salienceFight(makeStake('home', 'points_below_safety_n', { n: 2 }))).toBe('relegation');
    expect(salienceFight(makeStake('home', 'entered_zone', { zone: 'sudamericana' }))).toBe('zone');
    expect(salienceFight(makeStake('home', 'stayed_at_n', { n: 1 }))).toBe('table');
    expect(salienceFight(makeStake('both', 'draw_goes_to_penalties'))).toBe('other');
  });
});

describe('Brasileirão 2026, rodada 32 (pré-jogo)', () => {
  it('Flamengo × Atlético-MG: título e Libertadores, sem "risco de rebaixamento"', () => {
    const { all, salient } = preMatch('flamengo', 'atletico-mg');
    expect(codes(all, 'home')).toEqual([
      'in_title_race',
      'qualifies_for_sudamericana',
      'clinches_libertadores_group_stage_with_win',
    ]);
    expect(codes(all, 'away')).toEqual([
      'in_title_race',
      'can_qualify_for_libertadores_group_stage',
      'at_risk_of_relegation',
      'secures_safety_with_win',
    ]);
    // "garante ao menos a Sul-Americana" é piso superado pela Libertadores em jogo
    expect(codes(salient, 'home')).toEqual(['clinches_libertadores_group_stage_with_win', 'in_title_race']);
    // Atlético-MG a 19 pontos do líder e 17 acima do Z4: só a Libertadores (4 pontos)
    expect(codes(salient, 'away')).toEqual(['can_qualify_for_libertadores_group_stage']);
    expect(salient.map((s) => localizeStake(s, ['pt-BR', 'es-AR']).text)).toEqual([
      {
        'pt-BR': 'Vitória garante a fase de grupos da Libertadores',
        'es-AR': 'Si gana, asegura la fase de grupos de la Libertadores',
      },
      { 'pt-BR': 'Ainda briga pelo título', 'es-AR': 'Sigue en la pelea por el título' },
      {
        'pt-BR': 'Ainda pode garantir a fase de grupos da Libertadores',
        'es-AR': 'Todavía puede conseguir la fase de grupos de la Libertadores',
      },
    ]);
  });

  it('Coritiba × Grêmio: rebaixamento, sem Libertadores', () => {
    const { all, salient } = preMatch('coritiba', 'gremio');
    expect(codes(all, 'home')).toContain('can_qualify_for_libertadores_group_stage');
    expect(codes(all, 'away')).toContain('can_qualify_for_libertadores_qualifying');
    expect(codes(salient, 'home')).toEqual(['at_risk_of_relegation']);
    expect(codes(salient, 'away')).toEqual(['at_risk_of_relegation']);
  });

  it('nenhum time da tabela tem mais que 3 códigos salientes; a lista completa não muda', () => {
    for (let i = 0; i < table.length; i += 2) {
      const h = table[i]!.teamId;
      const a = table[i + 1]!.teamId;
      const all = leagueMatchStakes({
        table,
        league,
        points: rules.standings.points,
        homeId: h,
        awayId: a,
        includePossibilities: true,
      });
      const copy = JSON.stringify(all);
      const salient = salientStakes(all, { home: standingOf(table, h), away: standingOf(table, a) });
      expect(codes(salient, 'home').length).toBeLessThanOrEqual(3);
      expect(codes(salient, 'away').length).toBeLessThanOrEqual(3);
      expect(JSON.stringify(all)).toBe(copy);
      for (const s of salient) expect(all).toContain(s);
    }
  });
});

describe('Brasileirão 2026, rodada 32 — Vasco 3 × 2 Corinthians (encerrado)', () => {
  const f = finishedLeagueMatchStakes(finishedInput(fx, 'vas-cor'));
  const before = leagueInputOf(f.before);
  const after = leagueInputOf(f.after);
  const pre = salientStakes(f.pre, {
    home: standingOf(before, 'vasco'),
    away: standingOf(before, 'corinthians'),
  });
  const result = salientStakes(f.result, {
    home: standingOf(after, 'vasco'),
    away: standingOf(after, 'corinthians'),
  });

  it('antes do jogo: dois times fugindo do rebaixamento (a Libertadores a 19 e 21 pontos sai)', () => {
    expect(codes(pre, 'home')).toEqual(['at_risk_of_relegation']);
    expect(codes(pre, 'away')).toEqual(['at_risk_of_relegation']);
  });

  it('resultado: subiu, a distância para cima e para baixo; "não alcança mais a Libertadores" sai', () => {
    expect(codes(result, 'home')).toEqual([
      'moved_up_to_13',
      'points_behind_sudamericana_1',
      'points_above_relegation_5',
    ]);
    expect(codes(result, 'away')).toEqual(['points_below_safety_2', 'stayed_at_17']);
    expect(codes(f.result, 'away')).toContain('lost_libertadores_group_stage_chance');
  });
});

describe('ordem e limite', () => {
  const standing = standingOf(table, 'vasco');

  it('decididos > decisivos > disputas > situação; até 3 por time', () => {
    const stakes = [
      makeStake('home', 'stayed_at_n', { n: 13 }),
      makeStake('home', 'at_risk_of_relegation'),
      makeStake('home', 'can_be_relegated'),
      makeStake('home', 'points_behind_zone_n', { zone: 'sudamericana', n: 1 }),
      makeStake('both', 'draw_goes_to_penalties'),
    ];
    const out = salientStakes(stakes, { home: standing });
    expect(out.map((s) => s.code)).toEqual([
      'can_be_relegated',
      'points_behind_sudamericana_1',
      'at_risk_of_relegation',
      'draw_goes_to_penalties',
    ]);
    expect(salientStakes(stakes, { home: standing }, { max: 1 }).map((s) => s.code)).toEqual([
      'can_be_relegated',
      'draw_goes_to_penalties',
    ]);
  });

  it('mata-mata passa direto, na ordem original', () => {
    const ko = [
      makeStake('home', 'advances_with_draw'),
      makeStake('away', 'needs_win_by_n', { n: 2 }),
      makeStake('away', 'win_by_n_goes_to_penalties', { n: 1 }),
    ];
    expect(salientStakes(ko, {})).toEqual(ko);
  });

  it('"livre do rebaixamento" sai quando há briga por vaga', () => {
    const s = { ...standing, remaining: 2 };
    const out = salientStakes(
      [
        makeStake('home', 'safe_from_relegation'),
        makeStake('home', 'can_clinch_zone', { zone: 'sudamericana' }),
      ],
      { home: s },
    );
    expect(out.map((x) => x.code)).toEqual(['can_clinch_sudamericana']);
  });
});
