import { describe, expect, it } from 'vitest';
import { AGENT_LOCALES, checkGeneratedText, joinSentences, type AgentLocale } from '../guardrails/index.js';
import { sampleCore } from '../testing/samples.js';
import { buildGoals, buildRecapFacts, type IncidentRow } from './facts.js';
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
});
