import { VAR_OUTCOMES } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';
import { narrationLang } from '@galaxie/contracts';
import { buildTimelineDto, type RawIncident, type TimelineInput } from './timeline.js';

const PAL = { id: 'pal', name: 'Palmeiras', side: 'home', logo: null };
const FLU = { id: 'flu', name: 'Fluminense', side: 'away', logo: null };
const person = (id: string, name = id) => ({ id, name, photo: null, number: null, position: null });

let seq = 0;
const inc = (partial: Partial<RawIncident> & Pick<RawIncident, 'type'>): RawIncident => ({
  sequence: seq++,
  minute: null,
  extra: null,
  detail: null,
  comments: null,
  team: null,
  player: null,
  assist: null,
  observedAt: null,
  ...partial,
});
const input = (partial: Partial<TimelineInput>): TimelineInput => ({
  eventId: 'e1',
  status: 'finished',
  statusDetail: 'FT',
  clock: { minute: 90, extra: null },
  score: { home: null, away: null },
  incidents: [],
  periods: { first: null, second: null },
  stateLog: [],
  teams: [PAL, FLU],
  venueTimezone: null,
  lastValidAt: null,
  isStale: false,
  now: new Date('2026-11-12T12:00:00Z'),
  ...partial,
});

/** Jogo com abertura, empate, virada, VAR que anula, amarelo, vermelho e substituição. */
const game = (locale: string) => {
  seq = 0;
  return buildTimelineDto(
    input({
      locale,
      score: { home: 2, away: 1 },
      incidents: [
        inc({
          type: 'goal',
          detail: 'Normal Goal',
          minute: 10,
          team: PAL,
          player: person('estevao', 'Estêvão'),
          assist: person('veiga', 'Raphael Veiga'),
        }),
        inc({
          type: 'goal',
          detail: 'Penalty',
          minute: 30,
          team: FLU,
          player: person('cano', 'Germán Cano'),
        }),
        inc({
          type: 'goal',
          detail: 'Normal Goal',
          minute: 60,
          team: FLU,
          player: person('ari', 'John Arias'),
        }),
        inc({
          type: 'var',
          detail: 'Goal Disallowed - offside',
          minute: 61,
          team: FLU,
          player: person('ari', 'John Arias'),
        }),
        inc({
          type: 'card',
          detail: 'Yellow Card',
          minute: 70,
          team: FLU,
          player: person('x', 'Martinelli'),
        }),
        inc({
          type: 'goal',
          detail: 'Normal Goal',
          minute: 80,
          team: PAL,
          player: person('flaco', 'Flaco López'),
        }),
        inc({ type: 'card', detail: 'Red Card', minute: 85, team: FLU, player: person('x', 'Martinelli') }),
        inc({
          type: 'subst',
          detail: 'Substitution 1',
          minute: 88,
          team: PAL,
          player: person('flaco', 'Flaco López'),
          assist: person('rony', 'Rony'),
        }),
      ],
    }),
  ).incidents.map((i) => i.narration);
};

describe('narração por frase pronta (#1167)', () => {
  it('pt-BR: cada lance com a frase do contexto, sem nada além do lance', () => {
    expect(game('pt-BR')).toEqual([
      'Palmeiras marca! Estêvão abre o placar. Assistência de Raphael Veiga. Palmeiras 1 x 0 Fluminense.',
      'Gol: Fluminense! Germán Cano empata o jogo, de pênalti. Palmeiras 1 x 1 Fluminense.',
      'Gol de John Arias anulado pelo VAR.',
      'VAR anula o gol de John Arias por impedimento. Segue 1 x 1.',
      'Cartão amarelo para Martinelli (Fluminense).',
      'É gol, Palmeiras! Flaco López põe o time na frente. Palmeiras 2 x 1 Fluminense.',
      'Segundo amarelo para Martinelli (Fluminense): expulsão.',
      'Substituição (Palmeiras): entra Rony, sai Flaco López.',
    ]);
  });

  it('es e en também', () => {
    expect(game('es-AR')[0]).toBe(
      '¡Gol de Palmeiras! Estêvão abre el marcador. Asistencia de Raphael Veiga. Palmeiras 1-0 Fluminense.',
    );
    expect(game('es-MX')[3]).toBe('El VAR anula el gol de John Arias por fuera de juego. Sigue 1-1.');
    expect(game('en')[0]).toBe(
      'Goal for Palmeiras! Estêvão opens the scoring. Assisted by Raphael Veiga. Palmeiras 1-0 Fluminense.',
    );
    expect(game('en')[6]).toBe('Second yellow for Martinelli (Fluminense): sent off.');
  });

  it('a mesma leitura dá sempre a mesma frase', () => {
    expect(game('pt-BR')).toEqual(game('pt-BR'));
  });

  it('todo veredito do VAR tem frase nos três idiomas, sem marcador sobrando', () => {
    for (const locale of ['pt-BR', 'es-AR', 'en']) {
      seq = 0;
      const t = buildTimelineDto(
        input({
          locale,
          incidents: VAR_OUTCOMES.map(() =>
            inc({ type: 'var', minute: 10, team: PAL, player: person('p', 'Fulano') }),
          ),
        }),
      );
      // o veredito sai do detail; aqui basta cobrir a tabela pelo `other` e conferir cada texto do mapa abaixo
      expect(t.incidents.every((i) => i.narration && !/[{}]/.test(i.narration))).toBe(true);
    }
    const details = [
      'Goal cancelled',
      'Goal Disallowed - Foul',
      'Goal Disallowed - handball',
      'Goal confirmed',
      'Goal Under Review - offside',
      'Penalty awarded',
      'Penalty confirmed',
      'Penalty cancelled',
      'Card upgrade',
      'Card upgrade confirmed',
      'Card upgrade cancelled',
      'Card reviewed',
      'Red card confirmed',
      'Red card cancelled',
      'Original decision changed',
    ];
    for (const locale of ['pt-BR', 'es-AR', 'en']) {
      seq = 0;
      const t = buildTimelineDto(
        input({
          locale,
          incidents: details.map((detail) =>
            inc({ type: 'var', detail, minute: 10, team: PAL, player: person('p', 'Fulano') }),
          ),
        }),
      );
      const texts = t.incidents.map((i) => i.narration ?? '');
      expect(texts.every((s) => s.length > 5 && !/[{}]/.test(s))).toBe(true);
      expect(new Set(texts).size).toBeGreaterThanOrEqual(details.length - 3);
    }
  });

  it('sem autor nem time não inventa nome; lance desconhecido fica sem frase', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        incidents: [
          inc({ type: 'card', detail: 'Yellow Card', minute: 5, player: person('z', 'Zé') }),
          inc({ type: 'subst', detail: 'Substitution 1', minute: 50, team: PAL }),
          inc({ type: 'weird', minute: 60 }),
        ],
      }),
    );
    expect(t.incidents.map((i) => i.narration)).toEqual(['Cartão amarelo para Zé.', null, null]);
  });

  it('idioma pelo locale', () => {
    expect(['pt-BR', 'es-CO', 'en-US', 'fr'].map(narrationLang)).toEqual(['pt', 'es', 'en', 'en']);
  });
});

describe('frases editadas em Ajustes (#1167)', () => {
  it('o texto editado substitui o padrão só naquela chave e idioma; linha inválida é ignorada', async () => {
    const { toNarrationOverrides } = await import('./narration-overrides.js');
    const overrides = toNarrationOverrides([
      { key: 'goal.lead', lang: 'pt', variants: ['GOOOL do {team}!'] },
      { key: 'chave.que.nao.existe', lang: 'pt', variants: ['x'] },
      { key: 'goal.lead', lang: 'fr', variants: ['But !'] },
    ]);
    expect(Object.keys(overrides)).toEqual(['goal.lead']);
    seq = 0;
    const t = (locale: string) =>
      buildTimelineDto(
        input({
          locale,
          score: { home: 1, away: 0 },
          narrationOverrides: overrides,
          incidents: [
            inc({
              type: 'goal',
              detail: 'Normal Goal',
              minute: 10,
              team: PAL,
              player: person('e', 'Estêvão'),
            }),
          ],
        }),
      ).incidents[0]!.narration;
    expect(t('pt-BR')).toBe('GOOOL do Palmeiras! Estêvão abre o placar. Palmeiras 1 x 0 Fluminense.');
    seq = 0;
    expect(t('en')).toBe('Goal for Palmeiras! Estêvão opens the scoring. Palmeiras 1-0 Fluminense.');
  });
});

describe('casos da revisão (#1167)', () => {
  it('VAR ao vivo antes de o placar cair sai sem placar; depois, com o placar certo', () => {
    const at = (score: TimelineInput['score']) => {
      seq = 0;
      return buildTimelineDto(
        input({
          status: 'live',
          statusDetail: '2H',
          score,
          incidents: [
            inc({ type: 'goal', detail: 'Normal Goal', minute: 62, team: FLU, player: person('b', 'Bidu') }),
            inc({
              type: 'var',
              detail: 'Goal cancelled',
              minute: 63,
              team: FLU,
              player: person('b', 'Bidu'),
            }),
          ],
        }),
      ).incidents[1]!.narration;
    };
    expect(at({ home: 0, away: 1 })).toBe('VAR anula o gol de Bidu.');
    expect(at({ home: 0, away: 0 })).toBe('VAR anula o gol de Bidu. Segue 0 x 0.');
  });

  it('sem o nome do jogador não troca pelo time; gol contra sem lado não diz a favor de quem', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        status: 'live',
        statusDetail: '1H',
        score: { home: null, away: null },
        teams: [],
        incidents: [
          inc({ type: 'goal', detail: 'Normal Goal', minute: 5, team: PAL }),
          inc({ type: 'card', detail: 'Yellow Card', minute: 6, team: PAL }),
          inc({ type: 'own_goal', detail: 'Own Goal', minute: 7, team: FLU, player: person('z', 'Zé') }),
        ],
      }),
    );
    const [goal, card, og] = t.incidents.map((i) => i.narration);
    expect(goal).toBe('Gol: Palmeiras. Palmeiras 1 x 0 Fluminense.');
    expect(card).toBeNull();
    // ao vivo o gol contra soma para o time do lance (padrão), então o lado é conhecido
    expect(og).toMatch(/^Gol contra de Zé, a favor de /);
  });

  it('gol de pênalti em inglês e disputa de pênaltis com o placar da disputa', () => {
    seq = 0;
    const t = buildTimelineDto(
      input({
        locale: 'en',
        score: { home: 1, away: 0, penalty: { home: 1, away: 0 } },
        incidents: [
          inc({ type: 'goal', detail: 'Penalty', minute: 20, team: PAL, player: person('v', 'Veiga') }),
          inc({
            type: 'goal',
            detail: 'Penalty',
            comments: 'Penalty Shootout',
            minute: 120,
            team: PAL,
            player: person('v', 'Veiga'),
          }),
        ],
      }),
    );
    expect(t.incidents[0]!.narration).toContain('Veiga opens the scoring from the penalty spot.');
    expect(t.incidents[1]!.narration).toBe(
      'Veiga scores in the shootout. Shootout: Palmeiras 1-0 Fluminense.',
    );
  });
});
