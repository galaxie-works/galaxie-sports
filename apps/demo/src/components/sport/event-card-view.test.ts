import type { Event } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { awaitingResult } from './event-card-view';

const noScore = { home: null, away: null };

describe('aguardando resultado', () => {
  it('jogo encerrado sem placar aguarda; com placar ou antes do fim, não', () => {
    expect(awaitingResult({ status: 'finished', score: noScore })).toBe(true);
    expect(awaitingResult({ status: 'finished', score: { home: 2, away: 1 } })).toBe(false);
    expect(awaitingResult({ status: 'scheduled', score: noScore })).toBe(false);
  });

  it('sessão de corrida: aguarda só sem a classificação dos pilotos', () => {
    const session = { type: 'race' } as unknown as NonNullable<Event['session']>;
    expect(awaitingResult({ status: 'finished', score: noScore, session, participants: [] })).toBe(true);
    expect(
      awaitingResult({ status: 'finished', score: noScore, session, participants: [{ position: 1 }] }),
    ).toBe(false);
  });

  it('luta de MMA encerrada (placar sempre vazio): aguarda só sem o desfecho da luta', () => {
    const result = { method: 'ko_tko', method_name: 'Nocaute', round: 2 };
    expect(awaitingResult({ status: 'finished', score: noScore, fight: { result } })).toBe(false);
    expect(awaitingResult({ status: 'finished', score: noScore, fight: { result: null } })).toBe(true);
  });
});
