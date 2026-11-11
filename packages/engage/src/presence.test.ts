import { describe, expect, it } from 'vitest';
import {
  PRESENCE_INTERACTION_EVERY_S,
  heartbeatVerdict,
  interactionDue,
  presenceMaxGames,
  wasPresent,
} from './presence.js';

const min = 60_000;

describe('presença ao vivo (B9, #906)', () => {
  it('aba oculta não conta', () => {
    expect(
      heartbeatVerdict({
        visible: false,
        interacted: true,
        lastInteractionAt: 0,
        windowStartedAt: 0,
        now: 1,
      }),
    ).toBe('hidden');
  });

  it('janela nova conta; sem toque por mais de 15 min deixa de contar até interagir', () => {
    const base = { visible: true, interacted: false };
    expect(heartbeatVerdict({ ...base, lastInteractionAt: null, windowStartedAt: null, now: 0 })).toBe(
      'counted',
    );
    expect(heartbeatVerdict({ ...base, lastInteractionAt: 0, windowStartedAt: 0, now: 14 * min })).toBe(
      'counted',
    );
    expect(heartbeatVerdict({ ...base, lastInteractionAt: 0, windowStartedAt: 0, now: 16 * min })).toBe(
      'interaction_needed',
    );
    // janela nova, mas o último toque no jogo foi há 16 min: não conta
    expect(heartbeatVerdict({ ...base, lastInteractionAt: 0, windowStartedAt: null, now: 16 * min })).toBe(
      'interaction_needed',
    );
    expect(
      heartbeatVerdict({
        ...base,
        interacted: true,
        lastInteractionAt: 0,
        windowStartedAt: 0,
        now: 16 * min,
      }),
    ).toBe('counted');
    expect(interactionDue(0, (PRESENCE_INTERACTION_EVERY_S - 60) * 1000)).toBe(true);
    expect(interactionDue(0, 5 * min)).toBe(false);
  });

  it('presença iniciada depois do evento não credita o evento', () => {
    const windows = [{ startedAt: 10 * min, lastSeenAt: 40 * min }];
    expect(wasPresent(windows, 9 * min)).toBe(false);
    expect(wasPresent(windows, 10 * min)).toBe(true);
    expect(wasPresent(windows, 25 * min)).toBe(true);
    expect(wasPresent(windows, 40 * min + 20_000)).toBe(true);
    expect(wasPresent(windows, 42 * min)).toBe(false);
    expect(wasPresent([], 1)).toBe(false);
  });

  it('limite de jogos: o cliente só baixa o da Galaxie, que tem teto', () => {
    expect(presenceMaxGames(null, null)).toBe(3);
    expect(presenceMaxGames(5, null)).toBe(5);
    expect(presenceMaxGames(50, null)).toBe(10);
    expect(presenceMaxGames(5, 2)).toBe(2);
    expect(presenceMaxGames(5, 8)).toBe(5);
    expect(presenceMaxGames(3, 0)).toBe(3);
  });
});
