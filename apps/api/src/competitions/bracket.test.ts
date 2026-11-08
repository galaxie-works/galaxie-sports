import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadCompetitionRules } from '@galaxie/rules/config';
import { buildBracket, buildTie, tieRulesOf, type BracketMatch, type BracketStage } from './bracket.js';

const RULES_DIR = fileURLToPath(new URL('../../../../config/rules', import.meta.url));

const T0 = Date.parse('2026-08-01T22:00:00Z');
const day = (n: number) => new Date(T0 + n * 86_400_000);
const team = (id: string) => ({
  id,
  name: id.toUpperCase(),
  provider_name: id,
  short_name: null,
  logo: null,
});
const participants = new Map(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => [id, team(id)]));

const stage = (id: string, kind: string, order: number, label: string | null = null): BracketStage => ({
  id,
  kind,
  name: { 'pt-BR': `fase ${id}`, en: `stage ${id}` },
  label,
  order,
});
const match = (
  id: string,
  stageId: string,
  home: string,
  away: string,
  at: number,
  score: [number, number] | null,
  extra: Partial<BracketMatch> = {},
): BracketMatch => ({
  id,
  stageId,
  startsAt: day(at),
  updatedAt: day(at),
  status: score ? 'finished' : 'scheduled',
  score: score ? { home: score[0], away: score[1] } : null,
  homeId: home,
  awayId: away,
  winnerId: null,
  ...extra,
});
const opts = { sport: 'football', participants, tz: 'UTC', rules: null, stageDone: false };

describe('chaveamento do mata-mata', () => {
  it('ida e volta: agregado do ponto de vista do mandante da ida e decisão nos pênaltis', () => {
    const tie = buildTie(
      'qf',
      [
        match('m1', 'qf', 'a', 'b', 0, [1, 0]),
        match('m2', 'qf', 'b', 'a', 7, [2, 1], {
          score: { home: 2, away: 1, penalty: { home: 3, away: 4 } },
        }),
      ],
      opts,
    );
    expect(tie.format).toBe('two_legs');
    expect(tie.home?.id).toBe('a');
    expect(tie.aggregate).toEqual({ home: 2, away: 2 });
    expect(tie.penalties).toEqual({ home: 4, away: 3 });
    expect(tie.winner_id).toBe('a');
    expect(tie.status).toBe('decided');
    expect(tie.legs.map((l) => l.leg)).toEqual([1, 2]);
    expect(tie.legs[1]!.penalty).toEqual({ home: 3, away: 4 });
  });

  it('volta ainda por jogar: em andamento, agregado parcial e sem vencedor', () => {
    const tie = buildTie(
      'qf',
      [match('m1', 'qf', 'a', 'b', 0, [3, 0]), match('m2', 'qf', 'b', 'a', 7, null)],
      opts,
    );
    expect(tie).toMatchObject({
      status: 'in_progress',
      winner_id: null,
      aggregate: { home: 3, away: 0 },
    });
  });

  it('regulamento de duas partidas com só a ida no banco: não decide pela ida', () => {
    const tie = buildTie('qf', [match('m1', 'qf', 'a', 'b', 0, [3, 0])], { ...opts, rules: { legs: 2 } });
    expect(tie.format).toBe('two_legs');
    expect(tie.winner_id).toBeNull();
    expect(tie.status).toBe('in_progress');
  });

  it('jogo único: sem agregado, vencedor pelo placar', () => {
    const tie = buildTie('f', [match('m1', 'f', 'c', 'd', 0, [0, 2])], opts);
    expect(tie).toMatchObject({ format: 'single', aggregate: null, winner_id: 'd', status: 'decided' });
  });

  it('série melhor de 7 (basquete): vitórias, decidida ao chegar a 4', () => {
    const legs = [
      match('g1', 'p', 'a', 'b', 0, [100, 90]),
      match('g2', 'p', 'a', 'b', 2, [95, 99]),
      match('g3', 'p', 'b', 'a', 4, [80, 88]),
      match('g4', 'p', 'b', 'a', 6, [85, 91]),
      match('g5', 'p', 'a', 'b', 8, [110, 101]),
    ];
    const tie = buildTie('p', legs, { ...opts, sport: 'basketball' });
    expect(tie).toMatchObject({ format: 'series', wins: { home: 4, away: 1 }, winner_id: 'a' });
    expect(tie.aggregate).toBeNull();
    const ongoing = buildTie('p', legs.slice(0, 3), { ...opts, sport: 'basketball' });
    expect(ongoing).toMatchObject({ wins: { home: 2, away: 1 }, winner_id: null, status: 'in_progress' });
  });

  it('série fechada com jogos "se necessário" ainda agendados e série curta pela fase seguinte', () => {
    const sweep = [
      match('g1', 'p', 'a', 'b', 0, [100, 90]),
      match('g2', 'p', 'a', 'b', 2, [100, 90]),
      match('g3', 'p', 'b', 'a', 4, [80, 90]),
      match('g4', 'p', 'b', 'a', 6, [80, 90]),
      match('g5', 'p', 'a', 'b', 8, null),
    ];
    expect(buildTie('p', sweep, { ...opts, sport: 'basketball' })).toMatchObject({
      status: 'decided',
      winner_id: 'a',
      wins: { home: 4, away: 0 },
    });
    // melhor de 5 em 3×0 com outra série da fase em andamento: decide porque o time já está na final
    const rounds = buildBracket({
      sport: 'volleyball',
      stages: [stage('sf', 'semi_final', 11000), stage('f', 'final', 13000)],
      matches: [
        match('s1', 'sf', 'a', 'b', 0, [3, 0]),
        match('s2', 'sf', 'a', 'b', 2, [3, 1]),
        match('s3', 'sf', 'b', 'a', 4, [0, 3]),
        match('t1', 'sf', 'c', 'd', 1, [3, 0]),
        match('t2', 'sf', 'c', 'd', 3, null),
        match('f1', 'f', 'a', 'x', 9, null),
      ],
      participants,
      locale: 'pt-BR',
      tz: 'UTC',
    });
    const ab = rounds[0]!.ties.find((t) => t.home?.id === 'a')!;
    expect(ab).toMatchObject({ status: 'decided', winner_id: 'a' });
    expect(rounds[0]!.ties.find((t) => t.home?.id === 'c')).toMatchObject({ status: 'in_progress' });
  });

  it('fases em ordem e confrontos na ordem do chaveamento (vencedores 1 e 2 se cruzam)', () => {
    const stages = [
      stage('sf', 'semi_final', 11000),
      stage('qf', 'quarter_final', 10000),
      stage('f', 'final', 13000),
    ];
    const matches = [
      // quartas pela data: c×d, a×b, g×h, e×f
      match('q1', 'qf', 'c', 'd', 0, [1, 0]),
      match('q2', 'qf', 'a', 'b', 1, [1, 0]),
      match('q3', 'qf', 'g', 'h', 2, [1, 0]),
      match('q4', 'qf', 'e', 'f', 3, [1, 0]),
      // semis: a×g e c×e
      match('s1', 'sf', 'a', 'g', 10, [2, 0]),
      match('s2', 'sf', 'c', 'e', 11, [0, 1]),
      match('f1', 'f', 'a', 'e', 20, null),
    ];
    const rounds = buildBracket({
      sport: 'football',
      stages,
      matches,
      participants,
      locale: 'pt-BR',
      tz: 'UTC',
    });
    expect(rounds.map((r) => r.kind)).toEqual(['quarter_final', 'semi_final', 'final']);
    expect(rounds[0]!.name).toBe('fase qf');
    expect(rounds[0]!.ties.map((t) => `${t.home?.id}${t.away?.id}`)).toEqual(['ab', 'gh', 'cd', 'ef']);
    expect(rounds[1]!.ties.map((t) => `${t.home?.id}${t.away?.id}`)).toEqual(['ag', 'ce']);
  });

  it('playoff dividido por semana vira uma fase só, separada pela profundidade', () => {
    const stages = [
      stage('w1', 'playoff', 4001, 'Play-offs - 1'),
      stage('w2', 'playoff', 4002, 'Play-offs - 2'),
      stage('w3', 'playoff', 4003, 'Play-offs - 3'),
    ];
    const matches = [
      // 1ª rodada (semana 1 e 2): a×b, c×d
      match('a1', 'w1', 'a', 'b', 0, [100, 90]),
      match('a2', 'w2', 'a', 'b', 8, [100, 90]),
      match('c1', 'w1', 'c', 'd', 1, [100, 90]),
      match('c2', 'w2', 'c', 'd', 9, [100, 90]),
      // final (semana 3): a×c
      match('f1', 'w3', 'a', 'c', 16, null),
    ];
    const rounds = buildBracket({
      sport: 'basketball',
      stages: stages.map((s) => ({ ...s, name: { 'pt-BR': `Playoffs · Rodada ${s.order - 4000}` } })),
      matches,
      participants,
      locale: 'pt-BR',
      tz: 'UTC',
    });
    expect(rounds.map((r) => [r.kind, r.name, r.ties.length])).toEqual([
      ['semi_final', 'Semifinal', 2],
      ['final', 'Final', 1],
    ]);
    expect(rounds[0]!.ties[0]!.wins).toEqual({ home: 2, away: 0 });
  });

  it('ignora fases que não são mata-mata e jogos cancelados ou sem os dois times', () => {
    const rounds = buildBracket({
      sport: 'football',
      stages: [stage('r', 'regular', 2000), stage('f', 'final', 13000)],
      matches: [
        match('x', 'r', 'a', 'b', 0, [1, 0]),
        match('y', 'f', 'a', 'b', 1, null, { status: 'cancelled' }),
        match('z', 'f', 'c', 'd', 2, null, { awayId: null }),
      ],
      participants,
      locale: 'pt-BR',
      tz: 'UTC',
    });
    expect(rounds).toEqual([]);
  });

  it('série sem regulamento: o tamanho sai dos jogos do par só quando os que sobram já passaram ou foram cancelados', () => {
    const later = day(30);
    const bo5 = [
      match('g1', 'p', 'a', 'b', 0, [3, 1]),
      match('g2', 'p', 'a', 'b', 2, [3, 0]),
      match('g3', 'p', 'b', 'a', 4, [1, 3]),
      match('g4', 'p', 'b', 'a', 6, null),
      match('g5', 'p', 'a', 'b', 8, null),
    ];
    const volley = { ...opts, sport: 'volleyball' };
    // os "se necessário" passaram do horário sem ser jogados: melhor de 5, fecha em 3×0
    expect(buildTie('p', bo5, { ...volley, now: later })).toMatchObject({
      status: 'decided',
      winner_id: 'a',
      wins: { home: 3, away: 0 },
    });
    // ainda no futuro: pode ser uma série maior listada aos poucos, segue aberta
    expect(buildTie('p', bo5, { ...volley, now: day(5) })).toMatchObject({
      status: 'in_progress',
      winner_id: null,
    });
    // melhor de 3 em 2×0 com o jogo 3 cancelado pelo fornecedor
    const bo3 = [match('g1', 'p', 'a', 'b', 0, [80, 70]), match('g2', 'p', 'b', 'a', 2, [70, 80])];
    const basket = { ...opts, sport: 'basketball' };
    expect(buildTie('p', bo3, { ...basket, now: day(3), cancelledLegs: 1 })).toMatchObject({
      status: 'decided',
      winner_id: 'a',
    });
    // 3×1 numa melhor de 7 listada aos poucos, com só o jogo 5 (futuro) listado: não fecha
    const bo7 = [
      match('h1', 'p', 'a', 'b', 0, [100, 90]),
      match('h2', 'p', 'a', 'b', 2, [100, 90]),
      match('h3', 'p', 'b', 'a', 4, [100, 90]),
      match('h4', 'p', 'b', 'a', 6, [80, 90]),
      match('h5', 'p', 'a', 'b', 8, null),
    ];
    expect(buildTie('p', bo7, { ...basket, now: day(7) })).toMatchObject({
      status: 'in_progress',
      winner_id: null,
      wins: { home: 3, away: 1 },
    });
    // pelo buildBracket: o cancelado entra na conta da série
    const rounds = buildBracket({
      sport: 'basketball',
      stages: [stage('sf', 'semi_final', 11000)],
      matches: [
        ...bo3.map((m) => ({ ...m, stageId: 'sf' })),
        match('g3', 'sf', 'a', 'b', 4, null, { status: 'cancelled' }),
      ],
      participants,
      locale: 'pt-BR',
      tz: 'UTC',
      now: day(3),
    });
    expect(rounds[0]!.ties[0]).toMatchObject({ status: 'decided', winner_id: 'a' });
    expect(rounds[0]!.ties[0]!.legs).toHaveLength(2);
  });

  describe('desempates do regulamento (config/rules)', () => {
    it('Copa do Brasil, 1ª fase: jogo único, empate classifica o visitante', async () => {
      const rules = await loadCompetitionRules('copa-do-brasil', { dir: RULES_DIR, season: 2026 });
      const r = tieRulesOf(rules, { kind: 'knockout_round', label: '1st Round' });
      expect(r).toMatchObject({ legs: 1, drawAdvantage: 'away' });
      const tie = buildTie('r1', [match('m1', 'r1', 'a', 'b', 0, [1, 1])], { ...opts, rules: r });
      expect(tie).toMatchObject({ format: 'single', status: 'decided', winner_id: 'b' });
    });

    it('Liga MX, Liguilla: agregado empatado passa o de melhor campanha na tabela do Apertura', async () => {
      const rules = await loadCompetitionRules('liga-mx', { dir: RULES_DIR, season: 2026 });
      const seedRows = [
        { group: 'Apertura', participantId: 'a', rank: 6 },
        { group: 'Apertura', participantId: 'b', rank: 3 },
      ];
      const r = tieRulesOf(rules, { kind: 'quarter_final', label: 'Apertura - Quarter-finals' }, seedRows);
      expect(r?.levelAdvantage).toBe('better_seed');
      const legs = [match('m1', 'qf', 'a', 'b', 0, [1, 0]), match('m2', 'qf', 'b', 'a', 7, [1, 0])];
      expect(buildTie('qf', legs, { ...opts, rules: r })).toMatchObject({
        aggregate: { home: 1, away: 1 },
        status: 'decided',
        winner_id: 'b',
      });
      // sem a tabela de referência: não inventa vencedor, o confronto fica em aberto
      const blind = tieRulesOf(rules, { kind: 'quarter_final', label: 'Apertura - Quarter-finals' });
      expect(buildTie('qf', legs, { ...opts, rules: blind })).toMatchObject({
        status: 'in_progress',
        winner_id: null,
      });
    });

    it('Champions até 2020/21: gol fora desempata o agregado (menos na final)', async () => {
      const rules = await loadCompetitionRules('uefa-champions-league', { dir: RULES_DIR, season: 2018 });
      const r = tieRulesOf(rules, { kind: 'round_of_16', label: 'Round of 16' });
      expect(r?.awayGoals).toBe(true);
      // a×b 2×1 na ida, b×a 1×0 na volta: 2×2 no agregado, b fez 1 gol fora e a nenhum
      const legs = [match('m1', 'r16', 'a', 'b', 0, [2, 1]), match('m2', 'r16', 'b', 'a', 7, [1, 0])];
      expect(buildTie('r16', legs, { ...opts, rules: r })).toMatchObject({
        aggregate: { home: 2, away: 2 },
        winner_id: 'b',
        status: 'decided',
      });
      const now = await loadCompetitionRules('uefa-champions-league', { dir: RULES_DIR, season: 2024 });
      expect(tieRulesOf(now, { kind: 'round_of_16', label: 'Round of 16' })?.awayGoals).toBe(false);
    });

    it('empate sem critério nem vencedor marcado: não sai decidido sem vencedor', () => {
      const legs = [match('m1', 'qf', 'a', 'b', 0, [1, 1]), match('m2', 'qf', 'b', 'a', 7, [0, 0])];
      expect(buildTie('qf', legs, opts)).toMatchObject({ status: 'in_progress', winner_id: null });
    });
  });
});
