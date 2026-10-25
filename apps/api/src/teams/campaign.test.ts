import { describe, expect, it } from 'vitest';
import type { CompetitionRules } from '@galaxie/rules';
import type { EventScore } from '@galaxie/db';
import {
  computeCampaign,
  decideTie,
  isOngoing,
  type CampaignInput,
  type CampaignMatch,
  type CampaignStage,
} from './campaign.js';
import { campaignText, tieScore } from './campaign-text.js';

const PAL = 'pal';
const stage = (id: string, kind: string, order: number, name?: Record<string, string>): CampaignStage => ({
  id,
  kind,
  order,
  name: name ?? null,
  providerLabel: null,
});

let seq = 0;
/** Partida do ponto de vista do mando: `[mandante, visitante]`, placar `[gols mandante, gols visitante]`. */
function match(
  stageId: string,
  date: string,
  [homeId, awayId]: [string, string],
  goals: [number, number] | null,
  extra: Partial<EventScore> & { winner?: string } = {},
): CampaignMatch {
  const { winner, ...score } = extra;
  return {
    id: `e${++seq}`,
    stageId,
    startsAt: new Date(date),
    status: goals ? 'finished' : 'scheduled',
    score: goals ? { home: goals[0], away: goals[1], ...score } : { home: null, away: null },
    homeId,
    awayId,
    winnerIds: winner ? [winner] : [],
  };
}

function input(o: Partial<CampaignInput> & Pick<CampaignInput, 'stages'>): CampaignInput {
  const tieMatches = o.tieMatches ?? [];
  return {
    teamId: PAL,
    teamEvents:
      o.teamEvents ??
      tieMatches
        .filter((m) => m.homeId === PAL || m.awayId === PAL)
        .map((m) => ({ id: m.id, stageId: m.stageId, status: m.status })),
    tieMatches,
    standing: null,
    seasonOpen: false,
    stageActivity: new Map(),
    rules: null,
    competitionType: 'cup',
    ...o,
  };
}

const rules = (ko: Partial<NonNullable<CompetitionRules['knockout']>['default']>): CompetitionRules => ({
  slug: 'x',
  name: 'x',
  format: 'cup',
  season: null,
  standings: {
    points: { win: 3, draw: 1, loss: 0 },
    tieBreakers: [],
  } as unknown as CompetitionRules['standings'],
  league: null,
  knockout: {
    default: {
      legs: 2,
      awayGoals: false,
      awayGoalsInExtraTime: false,
      extraTime: false,
      penalties: true,
      drawAdvantage: null,
      neutralVenue: false,
      decidesTitle: false,
      ...ko,
    },
    stages: {},
  },
  tables: [],
  sources: [],
});

const text = (i: CampaignInput, opp: string | null, locale = 'pt-BR') => {
  const c = computeCampaign(i)!;
  return { c, ...campaignText(c, locale, opp) };
};

describe('decideTie', () => {
  it('ida e volta: soma por participante, não por mando (na volta os mandos se invertem)', () => {
    const s = stage('f', 'final', 13000);
    const t = decideTie(
      PAL,
      s,
      [match('f', '2026-03-04', [PAL, 'nov'], [1, 0]), match('f', '2026-03-08', ['nov', PAL], [1, 2])],
      null,
    )!;
    expect(t).toMatchObject({ state: 'won', goalsFor: 3, goalsAgainst: 1, legs: 2, penalties: null });
  });

  it('agregado empatado vai aos pênaltis da volta', () => {
    const s = stage('sf', 'semi_final', 11000);
    const t = decideTie(
      PAL,
      s,
      [
        match('sf', '2026-10-15', ['flu', PAL], [1, 2]),
        match('sf', '2026-10-22', [PAL, 'flu'], [0, 1], {
          extratime: { home: 0, away: 0 },
          penalty: { home: 5, away: 3 },
        }),
      ],
      rules({}),
    )!;
    expect(t).toMatchObject({
      state: 'won',
      goalsFor: 2,
      goalsAgainst: 2,
      penalties: { for: 5, against: 3 },
    });
    expect(tieScore(t, 'pt-BR')).toBe('2–2 no agregado, 5–3 nos pênaltis');
    expect(tieScore(t, 'es-AR')).toBe('2–2 en el global, 5–3 en penales');
    expect(tieScore(t, 'en')).toBe('2–2 on aggregate, 5–3 on penalties');
  });

  it('gol fora quando o regulamento manda', () => {
    const s = stage('qf', 'quarter_final', 10000);
    const legs = [
      match('qf', '2019-08-21', [PAL, 'gre'], [0, 1]),
      match('qf', '2019-08-28', ['gre', PAL], [1, 2]),
    ];
    const withRule = decideTie(PAL, s, legs, rules({ awayGoals: true }))!;
    expect(withRule).toMatchObject({ state: 'won', awayGoals: true, goalsFor: 2, goalsAgainst: 2 });
    expect(tieScore(withRule, 'pt-BR')).toBe('2–2 no agregado, gols fora');
    // sem a regra: decide nos pênaltis (sem placar de pênaltis nem vencedor → indefinido)
    expect(decideTie(PAL, s, legs, rules({}))!.state).toBe('unknown');
  });

  it('jogo único empatado: vantagem do empate do regulamento', () => {
    const s = stage('r1', 'knockout_round', 5001);
    const legs = [match('r1', '2026-02-20', ['abc', PAL], [1, 1])];
    expect(decideTie(PAL, s, legs, rules({ legs: 1, drawAdvantage: 'away' }))!.state).toBe('won');
  });

  it('sem pênaltis no placar, usa o vencedor informado pelo fornecedor', () => {
    const s = stage('f', 'final', 13000);
    const legs = [match('f', '2026-11-28', [PAL, 'fla'], [1, 1], { winner: 'fla' })];
    expect(decideTie(PAL, s, legs, null)!.state).toBe('lost');
  });

  it('confronto com jogo por acontecer fica pendente com o placar da ida', () => {
    const s = stage('sf', 'semi_final', 11000);
    const t = decideTie(
      PAL,
      s,
      [match('sf', '2026-11-01', [PAL, 'vas'], [2, 1]), match('sf', '2026-11-08', ['vas', PAL], null)],
      null,
    )!;
    expect(t).toMatchObject({ state: 'pending', playedLegs: 1, goalsFor: 2, goalsAgainst: 1 });
    expect(tieScore(t, 'pt-BR')).toBe('ida: 2–1');
  });

  it('ida e volta no regulamento com só a ida carregada fica pendente, mesmo com saldo', () => {
    const s = stage('f', 'final', 13000);
    const ida = [match('f', '2026-11-04', [PAL, 'fla'], [3, 0])];
    const t = decideTie(PAL, s, ida, rules({}))!;
    expect(t).toMatchObject({ state: 'pending', playedLegs: 1, goalsFor: 3, goalsAgainst: 0 });
    expect(tieScore(t, 'pt-BR')).toBe('ida: 3–0');
    const c = computeCampaign(input({ stages: [s], tieMatches: ida, rules: rules({}), seasonOpen: true }))!;
    expect(c.status).toBe('in_progress');
    // temporada encerrada sem a volta (W.O., cancelada): decide com o que há
    expect(computeCampaign(input({ stages: [s], tieMatches: ida, rules: rules({}) }))!.status).toBe(
      'champion',
    );
    // a final em jogo único no regulamento decide com o jogo que há
    expect(decideTie(PAL, s, ida, rules({ legs: 1 }))!.state).toBe('won');
  });
});

describe('computeCampaign', () => {
  const cupStages = [
    stage('g', 'group', 2001, { 'pt-BR': 'Fase de grupos' }),
    stage('r16', 'round_of_16', 9000),
    stage('qf', 'quarter_final', 10000),
    stage('sf', 'semi_final', 11000),
    stage('f', 'final', 13000),
  ];

  it('campeão: venceu a final em ida e volta', () => {
    const r = text(
      input({
        stages: [stage('reg', 'regular', 1000), stage('sf', 'semi_final', 11000), stage('f', 'final', 13000)],
        tieMatches: [
          match('sf', '2026-03-01', [PAL, 'spfc'], [2, 1]),
          match('f', '2026-03-04', [PAL, 'nov'], [1, 0]),
          match('f', '2026-03-08', ['nov', PAL], [1, 2]),
        ],
      }),
      'Novorizontino',
    );
    expect(r.c).toMatchObject({ status: 'champion', stageKind: 'final' });
    expect(r.label).toBe('Campeão');
    expect(r.detail).toBe('Final contra Novorizontino (3–1 no agregado)');
    expect(campaignText(r.c, 'es-AR', 'Novorizontino')).toEqual({
      label: 'Campeón',
      detail: 'Final contra Novorizontino (3–1 en el global)',
    });
    expect(campaignText(r.c, 'en', 'Novorizontino')).toEqual({
      label: 'Champions',
      detail: 'Final vs Novorizontino (3–1 on aggregate)',
    });
  });

  it('vice: perdeu a final em jogo único', () => {
    const r = text(
      input({ stages: cupStages, tieMatches: [match('f', '2025-11-29', [PAL, 'fla'], [0, 1])] }),
      'Flamengo',
    );
    expect(r.c.status).toBe('runner_up');
    expect([r.label, r.detail]).toEqual(['Vice-campeão', 'Final contra Flamengo (0–1)']);
  });

  it('venceu a semifinal sem final marcada: "Na final"', () => {
    const r = text(
      input({
        stages: cupStages.filter((s) => s.kind !== 'final'),
        tieMatches: [
          match('sf', '2026-10-15', ['flu', PAL], [1, 2]),
          match('sf', '2026-10-22', [PAL, 'flu'], [0, 1], { penalty: { home: 5, away: 3 } }),
        ],
        seasonOpen: true,
      }),
      'Fluminense',
    );
    expect(r.c).toMatchObject({ status: 'in_progress', stageKind: 'final', advancedFrom: true });
    expect(r.label).toBe('Na final');
    expect(r.detail).toBe('Eliminou Fluminense nas semifinais (2–2 no agregado, 5–3 nos pênaltis)');
    expect(r.c.tie?.lastEventId).toBeTruthy();
    expect(isOngoing(r.c)).toBe(true);
  });

  it('eliminado nas quartas (jogo único) após avançar nas oitavas', () => {
    const full = text(
      input({
        stages: cupStages,
        tieMatches: [
          match('r16', '2025-06-28', [PAL, 'bot'], [1, 0], { extratime: { home: 1, away: 0 } }),
          match('qf', '2025-07-05', [PAL, 'che'], [1, 2]),
        ],
      }),
      'Chelsea',
    );
    expect(full.c).toMatchObject({ status: 'eliminated', stageKind: 'quarter_final' });
    expect([full.label, full.detail]).toEqual([
      'Eliminado nas quartas de final',
      'Derrota para Chelsea (1–2)',
    ]);
    expect(campaignText(full.c, 'en', 'Chelsea')).toEqual({
      label: 'Knocked out in the quarter-finals',
      detail: 'Lost to Chelsea (1–2)',
    });
    expect(campaignText(full.c, 'es-MX', 'Chelsea').label).toBe('Eliminado en cuartos de final');
  });

  it('prorrogação em jogo único aparece no placar', () => {
    const r = text(
      input({
        stages: cupStages,
        tieMatches: [match('r16', '2025-06-28', [PAL, 'bot'], [1, 0], { extratime: { home: 1, away: 0 } })],
      }),
      'Botafogo',
    );
    expect(r.c).toMatchObject({ status: 'in_progress', stageKind: 'quarter_final' });
    expect(r.detail).toBe('Eliminou Botafogo nas oitavas de final (1–0 na prorrogação)');
  });

  it('semifinal marcada: "Nas semifinais" contra o adversário', () => {
    const r = text(
      input({
        stages: cupStages,
        tieMatches: [
          match('qf', '2026-08-27', [PAL, 'san'], [3, 0]),
          match('qf', '2026-09-03', ['san', PAL], [0, 0]),
          match('sf', '2026-11-01', [PAL, 'vas'], null),
          match('sf', '2026-11-08', ['vas', PAL], null),
        ],
        seasonOpen: true,
      }),
      'Vasco DA Gama',
    );
    expect(r.c).toMatchObject({ status: 'in_progress', stageKind: 'semi_final' });
    expect([r.label, r.detail]).toEqual(['Nas semifinais', 'Contra Vasco DA Gama']);
    expect(r.c.tie?.lastEventId).toBeNull();
  });

  it('fase de grupos em andamento traz posição e pontos', () => {
    const r = text(
      input({
        stages: cupStages,
        teamEvents: [{ id: 'g1', stageId: 'g', status: 'scheduled' }],
        standing: { rank: 2, points: 7, played: 4, group: 'Group F' },
        seasonOpen: true,
      }),
      null,
    );
    expect(r.c).toMatchObject({
      status: 'in_progress',
      stageKind: 'group',
      rank: 2,
      points: 7,
      group: 'Group F',
    });
    expect([r.label, r.detail]).toEqual(['Na fase de grupos', '2º lugar · 7 pts']);
  });

  it('eliminado na fase de grupos quando o mata-mata começou sem o time', () => {
    const r = text(
      input({
        stages: cupStages,
        teamEvents: [{ id: 'g1', stageId: 'g', status: 'finished' }],
        standing: { rank: 3, points: 7, played: 6, group: 'Group F' },
        seasonOpen: true,
        stageActivity: new Map([
          ['g', { events: 48, open: 0 }],
          ['r16', { events: 8, open: 7 }],
        ]),
      }),
      null,
    );
    expect(r.c.status).toBe('eliminated');
    expect([r.label, r.detail]).toEqual(['Eliminado na fase de grupos', '3º lugar · 7 pts']);
  });

  it('fase de grupos com jogos de outros times por disputar não elimina, mesmo com o mata-mata cadastrado', () => {
    const groups = (activity: [string, { events: number; open: number }][]) =>
      computeCampaign(
        input({
          stages: cupStages,
          teamEvents: [{ id: 'g1', stageId: 'g', status: 'finished' }],
          standing: { rank: 3, points: 7, played: 6, group: 'Group F' },
          seasonOpen: true,
          stageActivity: new Map(activity),
        }),
      )!.status;
    // o time já fez os 6 jogos, mas o grupo ainda não acabou
    expect(groups([['g', { events: 48, open: 2 }]])).toBe('in_progress');
    // grupos encerrados e o mata-mata ainda sem jogos (sorteio por fazer): sem prova de eliminação
    expect(groups([['g', { events: 48, open: 0 }]])).toBe('in_progress');
    expect(
      groups([
        ['g', { events: 48, open: 2 }],
        ['r16', { events: 8, open: 8 }],
      ]),
    ).toBe('in_progress');
  });

  describe('fase de liga com classificação direta (zonas do regulamento)', () => {
    const uclStages = [
      stage('lp', 'league_phase', 2001, { 'pt-BR': 'Fase de liga' }),
      stage('po', 'playoff', 3000),
      stage('r16', 'round_of_16', 9000, { 'pt-BR': 'Oitavas de final' }),
      stage('qf', 'quarter_final', 10000),
      stage('f', 'final', 13000),
    ];
    const ucl = (zones: NonNullable<CompetitionRules['league']>['zones']): CompetitionRules => ({
      ...rules({}),
      format: 'league_phase',
      league: { teams: 36, matchesPerTeam: 8, meetingsPerPair: 1, title: false, zones },
    });
    const ZONES = [
      { id: 'round_of_16', kind: 'qualification' as const, from: 1, to: 8 },
      { id: 'knockout_playoff', kind: 'qualification' as const, from: 9, to: 24 },
      { id: 'elimination', kind: 'elimination' as const, from: 25, to: 36 },
    ];
    const campaign = (rank: number, r: CompetitionRules | null, seasonOpen = true) =>
      computeCampaign(
        input({
          stages: uclStages,
          teamEvents: [{ id: 'l8', stageId: 'lp', status: 'finished' }],
          standing: { rank, points: 16, played: 8, group: null },
          seasonOpen,
          // fase de liga encerrada e o playoff já em jogo, sem o time
          stageActivity: new Map([
            ['lp', { events: 144, open: 0 }],
            ['po', { events: 16, open: 8 }],
          ]),
          rules: r,
        }),
      )!;

    it('o top 8 vai direto às oitavas: em andamento, não eliminado por não jogar o playoff', () => {
      const c = campaign(3, ucl(ZONES));
      expect(c).toMatchObject({ status: 'in_progress', stageKind: 'round_of_16', rank: 3, points: 16 });
      expect(campaignText(c, 'pt-BR', null)).toEqual({
        label: 'Nas oitavas de final',
        detail: '3º lugar · 16 pts',
      });
      expect(isOngoing(c)).toBe(true);
    });

    it('9º–24º aguarda o playoff; 25º em diante é eliminado mesmo sem jogo do mata-mata', () => {
      expect(campaign(15, ucl(ZONES))).toMatchObject({ status: 'in_progress', stageKind: 'playoff' });
      expect(campaign(30, ucl(ZONES))).toMatchObject({ status: 'eliminated', stageKind: 'league_phase' });
    });

    it('sem zonas no regulamento (ou zona de vaga em outra competição), segue a evidência dos jogos', () => {
      expect(campaign(3, null).status).toBe('eliminated');
      const europa = ucl([{ id: 'europa_league_knockout_playoff', kind: 'qualification', from: 1, to: 36 }]);
      expect(campaign(3, europa).status).toBe('eliminated');
      // temporada encerrada sem o mata-mata carregado: a zona não basta para "em andamento"
      expect(campaign(3, ucl(ZONES), false).status).toBe('eliminated');
    });
  });

  it('disputa de 3º lugar conta', () => {
    const base = {
      stages: [...cupStages, stage('3p', 'third_place', 12000)],
    };
    const won = text(
      input({
        ...base,
        tieMatches: [
          match('sf', '2026-07-01', [PAL, 'x'], [0, 1]),
          match('3p', '2026-07-05', [PAL, 'y'], [2, 1]),
        ],
      }),
      'Y',
    );
    expect(won.c).toMatchObject({ status: 'third_place', rank: 3 });
    expect([won.label, won.detail]).toEqual(['3º lugar', 'Disputa de 3º lugar contra Y (2–1)']);
    const lost = text(
      input({
        ...base,
        tieMatches: [
          match('sf', '2026-07-01', [PAL, 'x'], [0, 1]),
          match('3p', '2026-07-05', ['y', PAL], [2, 1]),
        ],
      }),
      'Y',
    );
    expect(lost.c).toMatchObject({ status: 'eliminated', rank: 4 });
    expect(lost.label).toBe('4º lugar');
  });

  describe('pontos corridos', () => {
    const league = [stage('r1', 'regular', 1000), stage('r2', 'regular', 1001)];
    const standing = { rank: 2, points: 66, played: 31, group: 'Serie A' };

    it('em andamento: posição e pontos', () => {
      const r = text(
        input({
          stages: league,
          competitionType: 'league',
          teamEvents: [{ id: 'x', stageId: 'r2', status: 'scheduled' }],
          standing,
          seasonOpen: true,
        }),
        null,
      );
      expect(r.c).toMatchObject({ status: 'league', rank: 2, points: 66 });
      expect([r.label, r.detail]).toEqual(['2º lugar', '66 pts em 31 jogos']);
      expect(campaignText(r.c, 'en', null).label).toBe('2nd place');
    });

    it('encerrada: 1º é campeão, os demais terminam na posição', () => {
      const done = {
        stages: league,
        competitionType: 'league',
        teamEvents: [{ id: 'x', stageId: 'r2', status: 'finished' as const }],
      };
      const champ = text(
        input({ ...done, standing: { ...standing, rank: 1, points: 84, played: 38 } }),
        null,
      );
      expect([champ.c.status, champ.label, champ.detail]).toEqual([
        'champion',
        'Campeão',
        '1º lugar · 84 pts',
      ]);
      const second = text(input({ ...done, standing: { ...standing, points: 76, played: 38 } }), null);
      expect([second.c.status, second.label, second.detail]).toEqual([
        'finished_league',
        'Terminou em 2º',
        '76 pts em 38 jogos',
      ]);
      expect(campaignText(second.c, 'es-AR', null).label).toBe('Terminó 2º');
    });

    it('regulamento sem título (fase de liga) não declara campeão', () => {
      const r = computeCampaign(
        input({
          stages: league,
          competitionType: 'league',
          teamEvents: [{ id: 'x', stageId: 'r2', status: 'finished' }],
          standing: { ...standing, rank: 1 },
          rules: {
            ...rules({}),
            format: 'league',
            knockout: null,
            league: { title: false } as CompetitionRules['league'],
          },
        }),
      )!;
      expect(r.status).toBe('finished_league');
    });

    it('só tabela, sem jogos ligados a fases', () => {
      const r = computeCampaign(
        input({ stages: [], competitionType: 'league', standing, seasonOpen: true }),
      )!;
      expect(r.status).toBe('league');
      expect(computeCampaign(input({ stages: [], competitionType: 'cup' }))).toBeNull();
    });
  });
});
