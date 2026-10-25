import { describe, expect, it } from 'vitest';
import { AGENT_LOCALES, checkGeneratedText, joinSentences, type AgentLocale } from '../guardrails/index.js';
import { sampleCore } from '../testing/samples.js';
import {
  buildGoals,
  buildRecapFacts,
  buildRecapTie,
  type IncidentRow,
  type RecapKnockoutInput,
} from './facts.js';
import { recapFactSheet, recapFallback } from './recap.js';

const core = sampleCore({
  status: 'finished',
  statusDetail: 'FT',
  score: { home: 4, away: 1, halftime: { home: 2, away: 0 }, extratime: null, penalty: null },
  competition: { id: 'c', slug: 'brasileirao-serie-a', name: 'Serie A', tier: 1, labels: {} },
  stage: {
    id: 's',
    kind: 'regular',
    name: { 'pt-BR': 'Rodada 30', es: 'Fecha 30' },
    providerLabel: 'Regular Season - 30',
  },
});
const H = core.home.id;
const A = core.away.id;

/** Timeline do fixture 1492407 (gol contra creditado ao time do jogador, como na api-sports). */
const incidents: IncidentRow[] = [
  {
    sequence: 0,
    minute: 12,
    extra: null,
    type: 'goal',
    detail: 'Normal Goal',
    participantId: H,
    person: 'Atacante A',
    assist: 'Meia A',
  },
  {
    sequence: 1,
    minute: 30,
    extra: null,
    type: 'card',
    detail: 'Yellow Card',
    participantId: A,
    person: 'Zagueiro B',
    assist: null,
  },
  {
    sequence: 2,
    minute: 45,
    extra: 2,
    type: 'own_goal',
    detail: 'Own Goal',
    participantId: A,
    person: 'Zagueiro B',
    assist: null,
  },
  {
    sequence: 3,
    minute: 58,
    extra: null,
    type: 'penalty_missed',
    detail: 'Missed Penalty',
    participantId: A,
    person: 'Atacante B',
    assist: null,
  },
  {
    sequence: 4,
    minute: 63,
    extra: null,
    type: 'subst',
    detail: 'Substitution 1',
    participantId: A,
    person: 'Atacante B',
    assist: 'Reserva B',
  },
  {
    sequence: 5,
    minute: 70,
    extra: null,
    type: 'var',
    detail: 'Goal cancelled',
    participantId: H,
    person: 'Atacante A',
    assist: null,
  },
  {
    sequence: 6,
    minute: 77,
    extra: null,
    type: 'goal',
    detail: 'Penalty',
    participantId: H,
    person: 'Meia A',
    assist: null,
  },
  {
    sequence: 7,
    minute: 81,
    extra: null,
    type: 'goal',
    detail: 'Normal Goal',
    participantId: A,
    person: 'Reserva B',
    assist: null,
  },
  {
    sequence: 8,
    minute: 90,
    extra: 4,
    type: 'goal',
    detail: 'Normal Goal',
    participantId: H,
    person: 'Atacante A',
    assist: null,
  },
];

describe('fatos do resumo', () => {
  it('reconstrói placar parcial e credita o gol contra ao time beneficiado', () => {
    const goals = buildGoals(incidents, core, { home: 4, away: 1 });
    expect(goals.map((g) => [g.minute, g.team, g.type, g.score_after])).toEqual([
      [12, 'home', 'goal', { home: 1, away: 0 }],
      [45, 'home', 'own_goal', { home: 2, away: 0 }],
      [77, 'home', 'penalty', { home: 3, away: 0 }],
      [81, 'away', 'goal', { home: 3, away: 1 }],
      [90, 'home', 'goal', { home: 4, away: 1 }],
    ]);
  });

  it('aceita a outra convenção de gol contra (time beneficiado no incidente)', () => {
    const flipped = incidents.map((i) => (i.type === 'own_goal' ? { ...i, participantId: H } : i));
    expect(buildGoals(flipped, core, { home: 4, away: 1 }).map((g) => g.team)).toEqual([
      'home',
      'home',
      'home',
      'away',
      'home',
    ]);
  });

  it('ignora cobranças da disputa de pênaltis listadas como gols', () => {
    const shootout: IncidentRow[] = [
      { ...incidents[0]!, sequence: 0 },
      {
        sequence: 1,
        minute: 120,
        extra: null,
        type: 'goal',
        detail: 'Penalty',
        participantId: A,
        person: 'Reserva B',
        assist: null,
      },
    ];
    const goals = buildGoals(shootout, core, { home: 1, away: 0 });
    expect(goals).toHaveLength(1);
  });

  it('timeline inconsistente com o placar: lista gols sem placar parcial', () => {
    const goals = buildGoals(incidents.slice(0, 1), core, { home: 2, away: 0 });
    expect(goals).toHaveLength(1);
    expect(goals[0]!.score_after).toBeUndefined();
  });

  it('expulsões e pênaltis perdidos', () => {
    const facts = buildRecapFacts(core, incidents, null, AGENT_LOCALES)!;
    expect(facts.missed_penalties).toEqual([{ minute: 58, extra: null, team: 'away', player: 'Atacante B' }]);
    expect(facts.red_cards).toEqual([]);
    expect(facts.decided_by).toBe('regular');
    expect(facts.match.round).toBe(30);
  });
});

describe('resumo determinístico', () => {
  const facts = buildRecapFacts(
    core,
    incidents,
    { home: { possession_pct: 58 }, away: { possession_pct: 42 } },
    AGENT_LOCALES,
  )!;

  it('pt-BR', () => {
    expect(recapFallback(core, facts, 'pt-BR')).toEqual([
      'Fim de jogo: Palmeiras 4 x 1 Corinthians',
      "Gols do Palmeiras: Atacante A (12' e 90+4'), Zagueiro B (contra, 45+2') e Meia A (pênalti, 77')",
      "Gol do Corinthians: Reserva B (81')",
      "Pênalti perdido: Atacante B (Corinthians, 58')",
    ]);
  });

  it.each(AGENT_LOCALES)('passa nos guardrails (%s)', (locale: AgentLocale) => {
    const text = joinSentences(recapFallback(core, facts, locale));
    expect(
      checkGeneratedText(text, { locale, facts: recapFactSheet(core, facts, locale), surface: 'mobile' }),
    ).toEqual([]);
  });

  it('pênaltis e prorrogação', () => {
    const pen = sampleCore({
      status: 'finished',
      statusDetail: 'PEN',
      score: { home: 1, away: 1, penalty: { home: 3, away: 4 } },
    });
    const f = buildRecapFacts(pen, [], null, ['es-AR'])!;
    const s = recapFallback(pen, f, 'es-AR');
    expect(s[0]).toBe('Final del partido: Palmeiras 1-1 Corinthians; en los penales, Corinthians ganó 4-3');
    expect(
      checkGeneratedText(joinSentences(s), { locale: 'es-AR', facts: recapFactSheet(pen, f, 'es-AR') }),
    ).toEqual([]);
  });

  it('validador do resumo barra placar final errado e autor inventado', () => {
    const sheet = recapFactSheet(core, facts, 'pt-BR');
    const wrong = checkGeneratedText('O Palmeiras venceu o Corinthians por 3 a 1.', {
      locale: 'pt-BR',
      facts: sheet,
    });
    expect(wrong.map((v) => v.kind)).toContain('wrong_result');
    const ghost = checkGeneratedText("Fim de jogo: Palmeiras 4 x 1 Corinthians. Endrick marcou aos 12'.", {
      locale: 'pt-BR',
      facts: sheet,
    });
    expect(ghost.map((v) => [v.kind, v.value])).toContainEqual(['unknown_name', 'Endrick']);
  });

  it('quem só deu assistência ou perdeu pênalti não passa como autor de gol', () => {
    const sheet = recapFactSheet(core, facts, 'pt-BR');
    const scorers = (text: string) =>
      checkGeneratedText(text, { locale: 'pt-BR', facts: sheet })
        .filter((v) => v.kind === 'wrong_scorer')
        .map((v) => v.value);
    // Meia A deu a assistência do gol dos 12' e marcou o pênalti dos 77'; Atacante B perdeu o pênalti dos 58'
    expect(scorers("Atacante B marcou aos 58'.")).toEqual(['atacante b']);
    expect(scorers("Atacante B perdeu um pênalti aos 58' e Reserva B descontou aos 81'.")).toEqual([]);
    expect(scorers("Atacante A abriu o placar aos 12', com assistência de Meia A.")).toEqual([]);
  });
});

describe('mata-mata: agregado, quem passou e para onde', () => {
  // Semifinal da Libertadores, volta: Palmeiras 0 × 1 Fluminense, pênaltis 5 × 3; ida Fluminense 1 × 2 Palmeiras
  const semi = sampleCore({
    status: 'finished',
    statusDetail: 'PEN',
    score: {
      home: 0,
      away: 1,
      halftime: { home: 0, away: 0 },
      extratime: { home: 0, away: 0 },
      penalty: { home: 5, away: 3 },
    },
    stage: {
      id: 's',
      kind: 'semi_final',
      name: { 'pt-BR': 'Semifinal', es: 'Semifinales', en: 'Semi-finals' },
      providerLabel: 'Semi-finals',
    },
    venue: { name: 'Nubank Parque', city: 'São Paulo' },
    away: { id: 'away-id', side: 'away', name: 'Fluminense', shortName: 'FLU', aliases: [], labels: {} },
  });
  const secondLeg: RecapKnockoutInput = {
    legs: 2,
    leg: 2,
    firstLeg: { homeTeamId: 'away-id', awayTeamId: 'home-id', homeGoals: 1, awayGoals: 2 },
    aggregateBefore: { home: 2, away: 1 },
    extraTime: false,
    penalties: true,
    decidesTitle: false,
    awayGoals: false,
  };
  const goal: IncidentRow = {
    sequence: 0,
    minute: 82,
    extra: null,
    type: 'goal',
    detail: 'Normal Goal',
    participantId: 'away-id',
    person: 'Hércules',
    assist: null,
  };
  const facts = buildRecapFacts(semi, [goal], null, AGENT_LOCALES, secondLeg)!;

  it('agregado 2 × 2 e Palmeiras na final pelos pênaltis', () => {
    expect(facts.tie).toEqual({
      legs: 2,
      leg: 2,
      first_leg: { home: 2, away: 1 },
      aggregate: { home: 2, away: 2 },
      winner: 'home',
      decided_by: 'penalties',
      outcome: 'advances',
      next_stage: 'final',
    });
    expect(facts.aggregate).toEqual({ home: 2, away: 2 });
    expect(facts.match.venue).toBe('Nubank Parque');
  });

  it('o resumo determinístico abre com o desfecho do confronto', () => {
    expect(recapFallback(semi, facts, 'pt-BR')).toEqual([
      'Palmeiras se classificou para a final; o agregado ficou 2 x 2 e a vaga foi decidida nos pênaltis',
      'Fim de jogo: Palmeiras 0 x 1 Fluminense; nos pênaltis, Palmeiras venceu por 5 x 3',
      "Gol do Fluminense: Hércules (82')",
    ]);
    expect(recapFallback(semi, facts, 'es-AR')[0]).toBe(
      'Palmeiras se clasificó a la final; la serie quedó 2-2 en el global y se definió por penales',
    );
  });

  it.each(AGENT_LOCALES)('fallback do mata-mata passa nos guardrails (%s)', (locale: AgentLocale) => {
    const text = joinSentences(recapFallback(semi, facts, locale));
    expect(checkGeneratedText(text, { locale, facts: recapFactSheet(semi, facts, locale) })).toEqual([]);
  });

  it('texto bom com agregado, ida e pênaltis não é barrado; agregado inventado é', () => {
    const sheet = recapFactSheet(semi, facts, 'pt-BR');
    const good =
      "O Palmeiras se classificou para a final da Libertadores: perdeu por 0 a 1 para o Fluminense no Nubank Parque, com gol de Hércules aos 82', mas o agregado ficou 2 a 2 e venceu nos pênaltis por 5 a 3. Na ida, tinha vencido por 2 a 1.";
    expect(checkGeneratedText(good, { locale: 'pt-BR', facts: sheet })).toEqual([]);
    const bad = checkGeneratedText('O Palmeiras avançou com 3 a 2 no agregado.', {
      locale: 'pt-BR',
      facts: sheet,
    });
    expect(bad.map((v) => v.kind)).toContain('unknown_score');
    const oldName = checkGeneratedText('Palmeiras 0 x 1 Fluminense no Allianz Parque.', {
      locale: 'pt-BR',
      facts: sheet,
    });
    expect(oldName.map((v) => [v.kind, v.value])).toContainEqual(['unknown_name', 'Allianz Parque']);
  });

  it('texto que troca o classificado é barrado (cai no determinístico)', () => {
    const kinds = (text: string, locale: AgentLocale = 'pt-BR') =>
      checkGeneratedText(text, { locale, facts: recapFactSheet(semi, facts, locale) }).map((v) => v.kind);
    expect(kinds('O Fluminense venceu por 1 a 0 e se classificou para a final.')).toContain('wrong_outcome');
    expect(kinds('El Palmeiras quedó eliminado pese al 2-2 en el global.', 'es-AR')).toContain(
      'wrong_outcome',
    );
    expect(kinds('O Fluminense venceu por 1 a 0, mas foi eliminado nos pênaltis.')).not.toContain(
      'wrong_outcome',
    );
  });

  it('vitória no agregado, gol fora, jogo de ida e final em jogo único', () => {
    const tie = (
      final: { home: number; away: number },
      ko: RecapKnockoutInput | null,
      pen = null,
      kind = 'semi_final',
    ) => buildRecapTie({ stage: { ...semi.stage!, kind } }, final, pen, 'regular', ko);
    expect(tie({ home: 2, away: 0 }, secondLeg)).toMatchObject({
      aggregate: { home: 4, away: 1 },
      winner: 'home',
      decided_by: 'aggregate',
    });
    // gol fora (regulamento antigo): 0 × 1 empata o agregado em 2 × 2; o mandante fez 2 gols fora na ida, o visitante 1
    expect(tie({ home: 0, away: 1 }, { ...secondLeg, awayGoals: true })).toMatchObject({
      winner: 'home',
      decided_by: 'away_goals',
    });
    const firstLeg: RecapKnockoutInput = { ...secondLeg, leg: 1 };
    delete firstLeg.aggregateBefore;
    delete firstLeg.firstLeg;
    expect(tie({ home: 1, away: 1 }, firstLeg)).toMatchObject({ leg: 1, winner: null, outcome: null });
    const final = tie(
      { home: 1, away: 0 },
      { legs: 1, leg: null, extraTime: true, penalties: true, decidesTitle: true, awayGoals: false },
      null,
      'final',
    );
    expect(final).toMatchObject({ legs: 1, winner: 'home', outcome: 'title', next_stage: null });
    // sem contexto do motor de regras e sem agregado do fornecedor: não afirma desfecho
    expect(tie({ home: 0, away: 1 }, null)).toBeNull();
  });
});

describe('resumo da final: o campeão e o número do título', () => {
  const finalCore = sampleCore({
    status: 'finished',
    statusDetail: 'FT',
    score: { home: 2, away: 1 },
    stage: {
      id: 'f',
      kind: 'final',
      name: { 'pt-BR': 'Final', es: 'Final', en: 'Final' },
      providerLabel: 'Final',
    },
    away: {
      id: 'away-id',
      side: 'away',
      name: 'Estudiantes L.P.',
      shortName: 'EST',
      aliases: [],
      labels: {},
    },
  });
  const ko: RecapKnockoutInput = {
    legs: 1,
    leg: null,
    extraTime: true,
    penalties: true,
    decidesTitle: true,
    awayGoals: false,
    titlesBefore: { home: 3, away: 4 },
  };
  const facts = buildRecapFacts(finalCore, [], null, AGENT_LOCALES, ko)!;

  it('título de número títulos anteriores + 1 do campeão', () => {
    expect(facts.champion_titles).toEqual({ side: 'home', title_number: 4 });
  });

  it('fallback: "Palmeiras é tetracampeão" / "Palmeiras es tetracampeón"', () => {
    expect(recapFallback(finalCore, facts, 'pt-BR')[0]).toBe('Palmeiras é tetracampeão');
    expect(recapFallback(finalCore, facts, 'es-AR')[0]).toBe('Palmeiras es tetracampeón');
  });

  it.each(AGENT_LOCALES)('fallback da final passa nos guardrails (%s)', (locale: AgentLocale) => {
    const text = joinSentences(recapFallback(finalCore, facts, locale));
    expect(checkGeneratedText(text, { locale, facts: recapFactSheet(finalCore, facts, locale) })).toEqual([]);
  });

  it('sem contagem confiável, só "é campeão"', () => {
    const plain = buildRecapFacts(finalCore, [], null, AGENT_LOCALES, { ...ko, titlesBefore: { away: 4 } })!;
    expect(plain.champion_titles).toBeUndefined();
    expect(recapFallback(finalCore, plain, 'pt-BR')[0]).toBe('Palmeiras é campeão');
  });
});
